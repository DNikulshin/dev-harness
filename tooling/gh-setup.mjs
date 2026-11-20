#!/usr/bin/env node
/**
 * Настройка GitHub-процесса репозитория: метки, режим merge и защита `main`.
 *
 * Идемпотентен: метки создаются/обновляются (`--force`), настройки репозитория
 * перезаписываются теми же значениями. Требуется авторизованный `gh` с правами admin
 * на репозиторий; `--protect` — только на публичном репозитории или платном плане.
 *
 * Зачем скрипт, а не ручные клики: правила процесса (`docs/workflow.md`) должны
 * воспроизводиться одной командой — правки в UI не попадают в историю и расходятся
 * между репозиториями.
 *
 *   node tooling/gh-setup.mjs              метки + режим merge (squash-only)
 *   node tooling/gh-setup.mjs --protect    дополнительно защита ветки main (PR обязателен)
 *   node tooling/gh-setup.mjs --dry-run    показать вызовы, ничего не менять
 *
 * Переменные: REPO (по умолчанию — текущий репозиторий, `gh repo view`).
 *
 * Коды выхода: `0` — настроено; `2` — ошибка параметров или отказ `gh` на уровне прав
 * (нет admin, приватный репозиторий на free-плане); `1` — прочий отказ.
 *
 * Shebang нужен: скрипт запускается напрямую.
 */
import { execFileSync } from 'node:child_process';

import { isDirectRun } from '../scripts/lib/cycle/cli.mjs';

/** Метки процесса: имя, цвет, описание. Набор — из `docs/workflow.md`. */
export const LABELS = Object.freeze([
  { name: 'type:feature', color: '1f883d', description: 'Новая функциональность' },
  { name: 'type:bug', color: 'd73a4a', description: 'Ошибка или регрессия' },
  {
    name: 'type:chore',
    color: '6e7781',
    description: 'Инфраструктура, зависимости, рефакторинг',
  },
  { name: 'type:spike', color: '8250df', description: 'Исследование: нужно решение до кода' },
  { name: 'area:core', color: '0969da', description: 'Ядро цикла: scripts/, валидаторы' },
  { name: 'area:package', color: '1a7f37', description: 'Пакет: exports, bin, files, types' },
  { name: 'area:evals', color: 'bf8700', description: 'evals: цены, профили, сиды, скоринг' },
  { name: 'area:board', color: 'c5def5', description: 'Доска Projects, CI, правила веток' },
  { name: 'area:docs', color: 'db61a2', description: 'Документация и норматив протокола' },
  { name: 'status:todo', color: 'ededed', description: 'Бэклог, можно брать в работу' },
  { name: 'status:in-progress', color: 'fbca04', description: 'В работе' },
  { name: 'status:review', color: '0e8a16', description: 'Ждёт проверки владельца' },
  { name: 'status:blocked', color: 'b60205', description: 'Заблокировано' },
  { name: 'prio:p1', color: 'b60205', description: 'Блокирует потребителя' },
  { name: 'prio:p2', color: 'fbca04', description: 'Нужно к релизу' },
  { name: 'prio:p3', color: 'c2e0c6', description: 'Можно позже' },
  { name: 'size:s', color: 'd4c5f9', description: 'До полудня работы' },
  { name: 'size:m', color: 'd4c5f9', description: 'Один-два дня' },
  { name: 'size:l', color: 'd4c5f9', description: 'Больше двух дней: дробить' },
  { name: 'needs-owner', color: '5319e7', description: 'Нужно решение владельца' },
]);

/** Режим merge: только squash, ветка удаляется после мержа. */
export const MERGE_SETTINGS = Object.freeze({
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  delete_branch_on_merge: true,
});

/**
 * Обязательные проверки ветки `main`: имена job из workflows.
 * `checks (ubuntu-latest)` и `checks (macos-latest)` — матрица job `checks` в `ci.yml` (issue #68:
 * пакет объявляет `os: linux, darwin`, поэтому обе платформы обязательны),
 * `pr-references` — `pr-checks.yml` (ссылка `Closes #N` в теле PR).
 * При смене матрицы имена меняются вместе с ней: иначе required check никогда не появится
 * и merge встанет навсегда.
 */
export const REQUIRED_CHECKS = Object.freeze([
  'checks (ubuntu-latest)',
  'checks (macos-latest)',
  'pr-references',
]);

/** Имя ruleset защиты релизных тегов. */
export const TAG_RULESET = 'release-tags';

/** Шаблон тегов релиза: по нему потребитель ставит пакет (`#vX.Y.Z`). */
export const TAG_PATTERN = 'refs/tags/v*';

/** Ошибка настройки: в CLI превращается в код 2 (параметры, права, план). */
export class SetupError extends Error {}

/**
 * Исполнитель `gh`: аргументы и stdin → stdout. В тестах подменяется.
 * @typedef {(args: string[], options?: { input?: string }) => string} RunGh
 */

/**
 * Тело правил ветки `main` (REST `PUT /branches/main/protection`).
 * @typedef {object} ProtectionPayload
 * @property {{ strict: boolean, contexts: string[] }} required_status_checks
 * @property {boolean} enforce_admins
 * @property {{ required_approving_review_count: number, dismiss_stale_reviews: boolean }} required_pull_request_reviews
 * @property {null} restrictions
 * @property {boolean} allow_force_pushes
 * @property {boolean} allow_deletions
 * @property {boolean} required_linear_history
 * @property {boolean} required_conversation_resolution
 */

/**
 * Тело правил ветки `main`. PR обязателен всем, включая владельца (`enforce_admins`),
 * проверки — в актуальном состоянии с `main` (`strict`), force-push и удаление запрещены.
 * @param {readonly string[]} [checks] обязательные проверки
 * @returns {ProtectionPayload}
 */
export function protectionPayload(checks = REQUIRED_CHECKS) {
  return {
    required_status_checks: { strict: true, contexts: [...checks] },
    enforce_admins: true,
    required_pull_request_reviews: {
      required_approving_review_count: 0,
      dismiss_stale_reviews: true,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    // Squash-only — настройка репозитория, а линейная история — гейт: merge-коммит,
    // появившийся в обход настроек (UI, API, второй репозиторий), не пройдёт.
    required_linear_history: true,
    // Незакрытый комментарий в PR — незавершённое ревью: мерж ждёт «Resolve conversation».
    required_conversation_resolution: true,
  };
}

/**
 * Ruleset защиты тегов релиза: тег нельзя удалить или перезаписать.
 *
 * Тег — контракт для потребителя: он попадает в `devDependencies` как `#vX.Y.Z`. Перезапись
 * тега задним числом делает установку невоспроизводимой (у двух машин разный код под одним
 * тегом), а удаление оставляет потребителя с битой ссылкой. Это не защита `main`, поэтому
 * classic branch protection тут не помогает — нужен ruleset на `refs/tags/v*`.
 * @returns {object}
 */
export function tagRulesetPayload() {
  return {
    name: TAG_RULESET,
    target: 'tag',
    enforcement: 'active',
    conditions: { ref_name: { include: [TAG_PATTERN], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
  };
}

/**
 * Что включить в настройках безопасности репозитория: сканирование секретов и блокировку
 * push с секретом внутри. В репозитории ядра это не абстракция: в документации и workflow
 * фигурируют PAT и секреты доски, а случайная копия токена в коммит — утечка.
 *
 * Уже включённое не дублируется: на публичных репозиториях эти настройки включены по
 * умолчанию, и повторный PATCH отвечает 422.
 * @param {unknown} current значение `security_and_analysis` из `GET /repos/{repo}`
 * @returns {Record<string, unknown>} часть тела PATCH (пусто, если включать нечего)
 */
export function securityPatch(current) {
  const status = /** @type {any} */ (current)?.secret_scanning_push_protection?.status;
  if (status === 'enabled') return {};
  return {
    security_and_analysis: {
      secret_scanning: { status: 'enabled' },
      secret_scanning_push_protection: { status: 'enabled' },
    },
  };
}

/**
 * Аргументы `gh label create` для метки.
 * @param {{ name: string, color: string, description: string }} label
 * @param {string} repo
 * @returns {string[]}
 */
export function labelArgs(label, repo) {
  return [
    'label',
    'create',
    label.name,
    '--repo',
    repo,
    '--color',
    label.color,
    '--description',
    label.description,
    '--force',
  ];
}

/**
 * Настройка репозитория: метки, режим merge, по флагу — защита `main`.
 * @param {{
 *   run: RunGh,
 *   repo: string,
 *   protect?: boolean,
 *   dryRun?: boolean,
 *   log?: (line: string) => void,
 * }} params
 * @returns {{
 *   labels: number,
 *   merge: boolean,
 *   security: boolean,
 *   protected: boolean,
 *   tagRuleset: string,
 * }}
 */
export function setup({ run, repo, protect = false, dryRun = false, log = () => {} }) {
  /** @type {RunGh} */
  const exec = dryRun
    ? (args, options = {}) => {
        const stdin = options.input === undefined ? '' : ' (+ stdin)';
        log(`(dry-run) gh ${args.join(' ')}${stdin}`);
        return '{}';
      }
    : run;

  for (const label of LABELS) exec(labelArgs(label, repo));
  log(`метки: ${LABELS.length} (созданы или обновлены)`);

  // Настройки репозитория: режим merge + сканирование секретов, если ещё не включено.
  /** @type {Record<string, unknown>} */
  const repoPatch = { ...MERGE_SETTINGS };
  if (dryRun) {
    Object.assign(repoPatch, securityPatch(null));
  } else {
    /** @type {unknown} */
    let current = null;
    try {
      current = JSON.parse(run(['api', `repos/${repo}`]));
    } catch {
      // Не читается — включаем явно: лишний PATCH безопаснее выключенной проверки.
      current = null;
    }
    Object.assign(repoPatch, securityPatch(current));
  }
  exec(['api', '-X', 'PATCH', `repos/${repo}`, '--input', '-'], {
    input: JSON.stringify(repoPatch),
  });
  const security = repoPatch.security_and_analysis !== undefined;
  log(
    `merge: только squash, ветка удаляется после мержа; ` +
      `секреты: ${security ? 'сканирование и блокировка push включены' : 'уже включены'}`,
  );

  let protectedBranch = false;
  let tagRuleset = '';
  if (protect) {
    exec(['api', '-X', 'PUT', `repos/${repo}/branches/main/protection`, '--input', '-'], {
      input: JSON.stringify(protectionPayload()),
    });
    protectedBranch = true;
    log(
      `main: PR обязателен всем, обязательны проверки ${REQUIRED_CHECKS.join(', ')}, ` +
        'линейная история, комментарии должны быть закрыты',
    );

    // Ruleset тегов: ищем по имени — есть, обновляем (PUT), нет, создаём (POST).
    /** @type {any[]} */
    let rulesets = [];
    if (!dryRun) {
      try {
        const listed = JSON.parse(run(['api', `repos/${repo}/rulesets`]));
        rulesets = Array.isArray(listed) ? listed : [];
      } catch {
        rulesets = [];
      }
    }
    const existing = rulesets.find((item) => item?.name === TAG_RULESET);
    const rulesetPath = existing
      ? `repos/${repo}/rulesets/${existing.id}`
      : `repos/${repo}/rulesets`;
    exec(['api', '-X', existing === undefined ? 'POST' : 'PUT', rulesetPath, '--input', '-'], {
      input: JSON.stringify(tagRulesetPayload()),
    });
    tagRuleset = TAG_RULESET;
    log(`теги: ${TAG_PATTERN} нельзя удалить или перезаписать (ruleset ${TAG_RULESET})`);
  }

  return { labels: LABELS.length, merge: true, security, protected: protectedBranch, tagRuleset };
}

/**
 * Первая строка сообщения об ошибке: в лог не должно попадать полотно.
 * @param {unknown} error
 * @returns {string}
 */
function firstLine(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? '';
}

/** Исполнитель `gh` по умолчанию. */
const ghRun = (/** @type {string[]} */ args, /** @type {{input?: string}} */ options = {}) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(options.input === undefined ? {} : { input: options.input }),
  });

/**
 * Репозиторий по умолчанию.
 * @param {RunGh} run
 * @returns {string}
 */
export function resolveRepo(run) {
  /** @type {unknown} */
  const json = JSON.parse(run(['repo', 'view', '--json', 'nameWithOwner']));
  const name = String(/** @type {any} */ (json)?.nameWithOwner ?? '');
  if (name === '') throw new SetupError('gh repo view: не удалось определить репозиторий');
  return name;
}

/**
 * Точка входа CLI.
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv, run?: RunGh, log?: (line: string) => void }} [deps]
 * @returns {number} код выхода
 */
export function main({
  argv = process.argv.slice(2),
  env = process.env,
  run = ghRun,
  log = console.log,
} = {}) {
  try {
    const known = new Set(['--protect', '--dry-run']);
    const unknown = argv.filter((arg) => !known.has(arg));
    if (unknown.length > 0) {
      throw new SetupError(
        `неизвестный аргумент: ${unknown.join(' ')} (ожидаются --protect, --dry-run)`,
      );
    }

    const repo = (env.REPO ?? '').trim() || resolveRepo(run);
    const result = setup({
      run,
      repo,
      protect: argv.includes('--protect'),
      dryRun: argv.includes('--dry-run'),
      log,
    });

    log(
      `gh-setup: ${repo} — меток ${result.labels}, режим merge ${result.merge ? 'ok' : '—'}, ` +
        `секреты ${result.security ? 'включены' : 'уже включены'}, ` +
        `защита main ${result.protected ? 'ok' : 'не запрашивалась'}` +
        `${result.tagRuleset === '' ? '' : `, правила тегов ${result.tagRuleset}`}`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`gh-setup: ${firstLine(error)}\n`);
    return error instanceof SetupError ? 2 : 1;
  }
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) process.exitCode = main();
