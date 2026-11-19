#!/usr/bin/env node
/**
 * Синхронизация доски GitHub Projects (Kanban) с issues репозитория.
 *
 * Правила доски:
 *   - каждый issue репозитория получает карточку, если её ещё нет;
 *   - колонка (поле `Status`) выводится из меток `status:*`, закрытый issue → `Done`;
 *   - повторный запуск ничего не ломает и не дублирует карточки.
 *
 * Копия `scripts/gh-project-sync.sh` из проекта-источника, переписанная на Node: это инфраструктура
 * среды, а не механизм цикла (ADR [0003](../docs/adr/0003-environment-infrastructure.md)),
 * поэтому в пакет не входит — потребитель получает workflow и документацию, а не скрипт.
 * Отличия от bash-версии: нет зависимости от `jq` (разбор JSON — своим кодом), нет `grep`/`sed`
 * на каждый issue, а правила доски вынесены в чистые функции, которые проверяются тестами
 * без подставного `gh` в `PATH`.
 *
 * Доска читается одним GraphQL-снимком (`gh api graphql`): id проекта, поле `Status` с
 * опциями и карточки постранично по 100 — вместо трёх раздельных вызовов `gh project …`.
 *
 * Переменные окружения:
 *   PROJECT_TOKEN / GH_TOKEN  токен для `gh` (в workflow — секрет `PROJECT_TOKEN`);
 *   OWNER         владелец проекта (`@me` по умолчанию: `gh project` с логином требует
 *                 лишних прав токена, см. `docs/board.md`);
 *   REPO          репозиторий с issues (по умолчанию — текущий, по данным `gh repo view`);
 *   PROJECT_NUMBER номер проекта (обязателен: угадывание чужой доски молча — хуже ошибки);
 *   LIMIT         сколько issues и карточек читать за раз (по умолчанию 500);
 *   DRY_RUN       непустое значение — только показать план, в проект ничего не писать.
 *
 * Коды выхода: `0` — синхронизировано (или план в `DRY_RUN`); `2` — ошибка параметров,
 * проекта или доски; `1` — прочий отказ `gh`.
 */
import { execFileSync } from 'node:child_process';

import { isDirectRun } from '../scripts/lib/cycle/cli.mjs';

/** Колонки доски: имена опций поля `Status`. Порядок — нормативный, как в документации. */
export const COLUMNS = Object.freeze(['Todo', 'In progress', 'Review', 'Blocked', 'Done']);

/** Метки статуса: колонка определяется ими, приоритет задан в `desiredStatus`. */
export const STATUS_LABELS = Object.freeze({
  review: 'status:review',
  inProgress: 'status:in-progress',
  blocked: 'status:blocked',
});

/** GitHub отдаёт не больше 100 узлов на страницу, сколько бы `first` ни просили. */
export const PAGE_SIZE = 100;

/** Ошибка параметров, проекта или доски: в CLI превращается в код 2, а не в трассировку. */
export class BoardError extends Error {}

/**
 * Снимок доски одним запросом: id проекта, поле `Status` (id + опции) и карточки.
 * Фрагмент общий для `User` и `Organization`: доска бывает и личной, и организационной.
 */
const SNAPSHOT_QUERY = `query ($owner: String!, $number: Int!, $first: Int!, $after: String) {
  repositoryOwner(login: $owner) {
    ... on User { projectV2(number: $number) { ...BoardSnapshot } }
    ... on Organization { projectV2(number: $number) { ...BoardSnapshot } }
  }
}

fragment BoardSnapshot on ProjectV2 {
  id
  statusField: field(name: "Status") {
    ... on ProjectV2SingleSelectField {
      id
      options { id name }
    }
  }
  items(first: $first, after: $after) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      content { __typename ... on Issue { number } }
      status: fieldValueByName(name: "Status") {
        ... on ProjectV2ItemFieldSingleSelectValue { name }
      }
    }
  }
}`;

/**
 * @typedef {(args: string[]) => string} RunGh исполнитель `gh`: аргументы → stdout
 */

/**
 * @typedef {object} Issue
 * @property {number} number
 * @property {string} state `OPEN` | `CLOSED`
 * @property {string[]} labels имена меток
 * @property {string} url
 */

/**
 * @typedef {object} Card
 * @property {string} id id карточки в проекте
 * @property {string} status текущая колонка (`''` — карточка без `Status`)
 */

/**
 * @typedef {object} Board
 * @property {string} projectId
 * @property {string} statusFieldId
 * @property {Map<string, string>} options колонка → id опции
 * @property {Map<number, Card>} cards номер issue → карточка
 */

/**
 * Колонка по правилам доски. Порядок проверок задаёт приоритет: если на issue висят
 * несколько меток статуса, побеждает более поздняя (`blocked` > `in-progress` > `review`).
 * Закрытый issue всегда `Done`, какие бы метки на нём ни остались.
 * @param {string} state состояние issue (`OPEN` | `CLOSED`)
 * @param {readonly string[]} labels имена меток
 * @returns {string} имя колонки
 */
export function desiredStatus(state, labels) {
  if (state === 'CLOSED') return 'Done';
  const set = new Set(labels);
  if (set.has(STATUS_LABELS.blocked)) return 'Blocked';
  if (set.has(STATUS_LABELS.inProgress)) return 'In progress';
  if (set.has(STATUS_LABELS.review)) return 'Review';
  return 'Todo';
}

/**
 * Разбор первой (или очередной) страницы GraphQL-снимка.
 *
 * Ошибки отдельными текстами: null вместо проекта — неверный владелец/номер, отсутствие поля
 * `Status` — доска не из шаблона Kanban. Молчаливый «пустой снимок» хуже отказа: синк
 * «успешно» ничего не делает, а доска расходится с репозиторием.
 * @param {unknown} json разобранный ответ `gh api graphql`
 * @returns {{
 *   projectId: string,
 *   statusFieldId: string,
 *   options: Map<string, string>,
 *   cards: Map<number, Card>,
 *   totalCount: number,
 *   hasNextPage: boolean,
 *   endCursor: string | null,
 * }}
 */
export function parseSnapshot(json) {
  /** @type {any} */
  const data = json;
  const project = data?.data?.repositoryOwner?.projectV2;
  if (!project) throw new BoardError('проект не найден: проверьте OWNER и PROJECT_NUMBER');

  const statusField = project.statusField;
  if (!statusField?.id)
    throw new BoardError('в проекте нет поля Status — доска не из шаблона Kanban');

  /** @type {Map<string, string>} */
  const options = new Map();
  for (const option of statusField.options ?? []) {
    options.set(String(option.name), String(option.id));
  }

  /** @type {Map<number, Card>} */
  const cards = new Map();
  for (const node of project.items?.nodes ?? []) {
    if (node?.content?.__typename !== 'Issue') continue;
    const number = Number(node.content.number);
    cards.set(number, { id: String(node.id), status: String(node.status?.name ?? '') });
  }

  return {
    projectId: String(project.id),
    statusFieldId: String(statusField.id),
    options,
    cards,
    totalCount: Number(project.items?.totalCount ?? 0),
    hasNextPage: project.items?.pageInfo?.hasNextPage === true,
    endCursor: project.items?.pageInfo?.endCursor ?? null,
  };
}

/**
 * Чтение доски постранично.
 *
 * `LIMIT` — защита от «усечённой» выдачи: при `items.totalCount > LIMIT` синк отменяется,
 * иначе часть карточек молча не попала бы в снимок, и уже стоящие в правильной колонке
 * карточки выглядели бы отсутствующими (дубли и лишние записи).
 * @param {{ run: RunGh, owner: string, number: number, limit: number }} params
 * @returns {Board}
 */
export function snapshotBoard({ run, owner, number, limit }) {
  /** @type {Board} */
  const board = {
    projectId: '',
    statusFieldId: '',
    options: new Map(),
    cards: new Map(),
  };
  let totalCount = 0;
  /** @type {string | null} */
  let after = null;
  let pages = 0;

  for (;;) {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${SNAPSHOT_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-F',
      `number=${number}`,
      '-F',
      `first=${PAGE_SIZE}`,
    ];
    if (after !== null) args.push('-f', `after=${after}`);

    /** @type {ReturnType<typeof parseSnapshot>} */
    let snapshot;
    try {
      snapshot = parseSnapshot(JSON.parse(run(args)));
    } catch (error) {
      const reason =
        error instanceof BoardError
          ? error.message
          : `gh api graphql: ответ не разобран (${firstLine(error)})`;
      throw new BoardError(`проект #${number} у владельца ${owner}: ${reason}`);
    }

    if (pages === 0) {
      board.projectId = snapshot.projectId;
      board.statusFieldId = snapshot.statusFieldId;
      board.options = snapshot.options;
      totalCount = snapshot.totalCount;
      if (totalCount > limit) {
        throw new BoardError(
          `на доске ${totalCount} карточек при LIMIT=${limit} — выдача усечена, синк отменён; ` +
            `запустите с LIMIT=${totalCount + PAGE_SIZE}`,
        );
      }
    }
    for (const [issue, card] of snapshot.cards) board.cards.set(issue, card);

    pages += 1;
    if (!snapshot.hasNextPage) break;
    after = snapshot.endCursor;
    if (after === null || pages * PAGE_SIZE >= limit) {
      throw new BoardError(
        `доска не дочитана за ${pages} страниц при LIMIT=${limit} — синк отменён; ` +
          `запустите с LIMIT=${limit * 2}`,
      );
    }
  }

  const missing = COLUMNS.filter((column) => !board.options.has(column));
  if (missing.length > 0) {
    throw new BoardError(
      `в поле Status нет опций ${missing.map((name) => `«${name}»`).join(', ')} — ` +
        'доска должна иметь колонки Todo / In progress / Review / Blocked / Done',
    );
  }

  return board;
}

/**
 * Issues репозитория.
 *
 * Список читается целиком и не через `--jq`: ошибка `gh` должна прервать прогон, а не
 * превратиться в пустой список и «успешную» синхронизацию без карточек.
 * @param {{ run: RunGh, repo: string, limit: number }} params
 * @returns {Issue[]}
 */
export function readIssues({ run, repo, limit }) {
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(
      run([
        'issue',
        'list',
        '--repo',
        repo,
        '--state',
        'all',
        '--limit',
        String(limit),
        '--json',
        'number,state,labels,url',
      ]),
    );
  } catch (error) {
    if (error instanceof BoardError) throw error;
    throw new BoardError(`gh issue list: ${firstLine(error)}`);
  }
  if (!Array.isArray(json)) throw new BoardError('gh issue list: ожидался список issues');

  const issues = json.map((raw) => {
    const { number, state, labels, url } = /** @type {any} */ (raw);
    const names = Array.isArray(labels) ? labels.map((label) => String(label.name)) : [];
    return { number: Number(number), state: String(state), labels: names, url: String(url) };
  });

  if (issues.length >= limit) {
    throw new BoardError(
      `в репозитории ${issues.length} issues при LIMIT=${limit} — выдача усечена, синк отменён; ` +
        `запустите с LIMIT=${limit * 2}`,
    );
  }
  return issues;
}

/**
 * План синхронизации: что добавить, что перенести, что уже на месте.
 * Чистая функция — тесты проверяют правила доски без обращений к GitHub.
 * @param {{ cards: Map<number, Card>, issues: readonly Issue[] }} input
 * @returns {{
 *   adds: { issue: Issue, to: string }[],
 *   moves: { issue: Issue, id: string, from: string, to: string }[],
 *   unchanged: number,
 * }}
 */
export function planSync({ cards, issues }) {
  /** @type {{ issue: Issue, to: string }[]} */
  const adds = [];
  /** @type {{ issue: Issue, id: string, from: string, to: string }[]} */
  const moves = [];
  let unchanged = 0;

  for (const issue of issues) {
    const to = desiredStatus(issue.state, issue.labels);
    const card = cards.get(issue.number);
    if (!card) {
      adds.push({ issue, to });
      continue;
    }
    if (card.status === to) {
      unchanged += 1;
      continue;
    }
    moves.push({ issue, id: card.id, from: card.status, to });
  }

  return { adds, moves, unchanged };
}

/**
 * Перенос карточки в колонку.
 * @param {{ run: RunGh, board: Board, cardId: string, column: string }} params
 * @returns {void}
 */
function moveCard({ run, board, cardId, column }) {
  const optionId = board.options.get(column);
  if (optionId === undefined) throw new BoardError(`в поле Status нет опции «${column}»`);
  run([
    'project',
    'item-edit',
    '--project-id',
    board.projectId,
    '--id',
    cardId,
    '--field-id',
    board.statusFieldId,
    '--single-select-option-id',
    optionId,
  ]);
}

/**
 * Синхронизация доски.
 *
 * В `DRY_RUN` не выполняется ни одной записи: план печатается, `gh` вызывается только на
 * чтение. Это проверяется тестом, а не обещанием в документации.
 * @param {{
 *   run: RunGh,
 *   owner: string,
 *   repo: string,
 *   number: number,
 *   limit?: number,
 *   dryRun?: boolean,
 *   log?: (line: string) => void,
 * }} params
 * @returns {{ added: number, moved: number, unchanged: number, written: number }}
 */
export function syncBoard({
  run,
  owner,
  repo,
  number,
  limit = 500,
  dryRun = false,
  log = () => {},
}) {
  const board = snapshotBoard({ run, owner, number, limit });
  const issues = readIssues({ run, repo, limit });
  const plan = planSync({ cards: board.cards, issues });

  for (const { issue, id, from, to } of plan.moves) {
    log(`перенести  #${issue.number}: ${from || '—'} → ${to}`);
    if (!dryRun) moveCard({ run, board, cardId: id, column: to });
  }

  for (const { issue, to } of plan.adds) {
    log(`добавить   #${issue.number} → ${to}`);
    if (dryRun) continue;
    const created = JSON.parse(
      run([
        'project',
        'item-add',
        String(number),
        '--owner',
        owner,
        '--url',
        issue.url,
        '--format',
        'json',
      ]),
    );
    const cardId = String(/** @type {any} */ (created).id ?? '');
    if (cardId === '')
      throw new BoardError(`gh project item-add: нет id карточки для #${issue.number}`);
    // Новая карточка создаётся без Status: колонку проставляем сразу, иначе следующий
    // прогон увидит её как «изменённую» повторно.
    moveCard({ run, board, cardId, column: to });
  }

  const written = dryRun ? 0 : plan.adds.length + plan.moves.length;
  return { added: plan.adds.length, moved: plan.moves.length, unchanged: plan.unchanged, written };
}

/**
 * Первая строка сообщения об ошибке: в лог workflow не должно попадать полотно.
 * @param {unknown} error
 * @returns {string}
 */
function firstLine(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? '';
}

/** Исполнитель `gh` по умолчанию: stdout как UTF-8, stderr — в сообщение ошибки. */
const ghRun = (/** @type {string[]} */ args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Логин владельца: `@me` резолвится через `viewer` (`gh api user`), потому что `gh project`
 * с явным логином требует дополнительных прав токена (см. `docs/board.md`).
 * @param {{ run: RunGh, owner: string }} params
 * @returns {string}
 */
export function resolveOwner({ run, owner }) {
  if (owner !== '@me') return owner;
  /** @type {unknown} */
  const json = JSON.parse(run(['api', 'user']));
  const login = String(/** @type {any} */ (json)?.login ?? '');
  if (login === '') throw new BoardError('gh api user: не удалось определить логин владельца');
  return login;
}

/**
 * Репозиторий по умолчанию: текущий, по данным `gh repo view`.
 * @param {RunGh} run
 * @returns {string}
 */
export function resolveRepo(run) {
  /** @type {unknown} */
  const json = JSON.parse(run(['repo', 'view', '--json', 'nameWithOwner']));
  const name = String(/** @type {any} */ (json)?.nameWithOwner ?? '');
  if (name === '') throw new BoardError('gh repo view: не удалось определить репозиторий');
  return name;
}

/**
 * Число из переменной окружения: пустое — значение по умолчанию, мусор — ошибка.
 * @param {string|undefined} raw
 * @param {string} name имя переменной для текста ошибки
 * @param {number} [fallback]
 * @returns {number}
 */
function envNumber(raw, name, fallback) {
  if (raw === undefined || raw.trim() === '') {
    if (fallback === undefined) throw new BoardError(`${name} не задан`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new BoardError(`${name}: ожидается положительное целое, получено «${raw}»`);
  }
  return value;
}

/**
 * Точка входа CLI.
 * @param {{ env?: NodeJS.ProcessEnv, run?: RunGh, log?: (line: string) => void }} [deps]
 * @returns {number} код выхода
 */
export function main({ env = process.env, run = ghRun, log = console.log } = {}) {
  try {
    const dryRun = (env.DRY_RUN ?? '').trim() !== '';
    const number = envNumber(env.PROJECT_NUMBER, 'PROJECT_NUMBER');
    const limit = envNumber(env.LIMIT, 'LIMIT', 500);
    const owner = resolveOwner({ run, owner: (env.OWNER ?? '@me').trim() || '@me' });
    const repo = (env.REPO ?? '').trim() || resolveRepo(run);

    const result = syncBoard({ run, owner, repo, number, limit, dryRun, log });
    const summary =
      `Доска #${number}: добавлено ${result.added}, обновлено ${result.moved}, ` +
      `без изменений ${result.unchanged}.`;
    log(
      dryRun ? `${summary} DRY_RUN: записей ${result.added + result.moved} не выполнено.` : summary,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`board-sync: ${firstLine(error)}\n`);
    return error instanceof BoardError ? 2 : 1;
  }
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) process.exitCode = main();
