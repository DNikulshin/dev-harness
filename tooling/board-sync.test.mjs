/**
 * Тесты `tooling/board-sync.mjs`.
 *
 * Скрипт разговаривает с GitHub только через `gh`, поэтому тесты подставляют исполнителя
 * `run`: он отдаёт заранее заготовленные ответы и записывает вызовы. Главное свойство,
 * которое проверяется без сети: в режиме `DRY_RUN` ни одна запись (`item-add`, `item-edit`)
 * не выполняется, а чтение идёт постранично и с защитой от усечения выдачи.
 *
 * Последний блок читает сам `.github/workflows/board-sync.yml`: правило «на каком событии
 * сверка выполняется» живёт в job-`if`, а не в скрипте, и без теста оно тихо разъезжается
 * с замыслом (issue #165).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BoardError,
  COLUMNS,
  PAGE_SIZE,
  desiredStatus,
  main,
  parseSnapshot,
  planSync,
  readIssues,
  resolveOwner,
  snapshotBoard,
  syncBoard,
} from './board-sync.mjs';

/**
 * Ответ `gh api graphql` с одной страницей карточек.
 * @param {object} params
 * @param {any[]} [params.nodes] карточки
 * @param {number} [params.totalCount] всего карточек на доске
 * @param {boolean} [params.hasNextPage]
 * @param {string|null} [params.endCursor]
 * @param {{id: string, name: string}[]} [params.options] опции поля Status
 * @param {string|null} [params.statusField] id поля Status (`null` — поля нет)
 * @returns {any}
 */
function page({
  nodes = [],
  totalCount = nodes.length,
  hasNextPage = false,
  endCursor = null,
  options = COLUMNS.map((name) => ({ id: `opt_${name}`, name })),
  statusField = 'FIELD_STATUS',
} = {}) {
  return {
    data: {
      repositoryOwner: {
        projectV2: {
          id: 'PROJECT_ID',
          statusField: statusField === null ? null : { id: statusField, options },
          items: {
            totalCount,
            pageInfo: { hasNextPage, endCursor },
            nodes,
          },
        },
      },
    },
  };
}

/**
 * Карточка issue на доске.
 * @param {number} number
 * @param {string} status
 * @returns {any}
 */
function card(number, status) {
  return {
    id: `item_${number}`,
    content: { __typename: 'Issue', number },
    status: status === '' ? null : { name: status },
  };
}

/**
 * Исполнитель `gh` с очередью ответов GraphQL и записью всех вызовов.
 * @param {{ pages?: any[], issues?: any[], user?: any, repo?: string }} [responses]
 * @returns {{ run: (args: string[]) => string, calls: string[][] }}
 */
function fakeGh({
  pages = [],
  issues = [],
  user = { login: 'octocat' },
  repo = 'acme/service',
} = {}) {
  /** @type {string[][]} */
  const calls = [];
  let index = 0;

  /** @param {string[]} args */
  const run = (args) => {
    calls.push(args);
    const [command, sub] = args;

    if (command === 'api' && sub === 'graphql') {
      const response = pages[index];
      index += 1;
      if (response === undefined) throw new Error(`fake gh: запрошена лишняя страница ${index}`);
      return JSON.stringify(response);
    }
    if (command === 'api' && sub === 'user') return JSON.stringify(user);
    if (command === 'repo') return JSON.stringify({ nameWithOwner: repo });
    if (command === 'issue') return JSON.stringify(issues);
    if (command === 'project' && sub === 'item-add') {
      const url = args[args.indexOf('--url') + 1] ?? '';
      return JSON.stringify({ id: `item_new_${url.split('/').pop()}` });
    }
    if (command === 'project' && sub === 'item-edit') return '';
    throw new Error(`fake gh: неожиданный вызов ${args.join(' ')}`);
  };

  return { run, calls };
}

/**
 * Issue в форме `gh issue list --json number,state,labels,url`.
 * @param {number} number
 * @param {'OPEN'|'CLOSED'} state
 * @param {string[]} [labels]
 * @returns {any}
 */
function issue(number, state, labels = []) {
  return {
    number,
    state,
    labels: labels.map((name) => ({ name })),
    url: `https://github.com/acme/service/issues/${number}`,
  };
}

/** Вызовы записи в проект: их в `DRY_RUN` быть не должно. */
const writes = (/** @type {string[][]} */ calls) =>
  calls.filter(
    (args) => args[0] === 'project' && (args[1] === 'item-add' || args[1] === 'item-edit'),
  );

describe('desiredStatus: колонка по меткам', () => {
  test('без меток статуса — Todo', () => {
    assert.equal(desiredStatus('OPEN', ['type:feature']), 'Todo');
  });

  test('метки status:* задают колонку', () => {
    assert.equal(desiredStatus('OPEN', ['status:review']), 'Review');
    assert.equal(desiredStatus('OPEN', ['status:in-progress']), 'In progress');
    assert.equal(desiredStatus('OPEN', ['status:blocked']), 'Blocked');
  });

  test('приоритет: blocked > in-progress > review', () => {
    assert.equal(desiredStatus('OPEN', ['status:review', 'status:in-progress']), 'In progress');
    assert.equal(
      desiredStatus('OPEN', ['status:review', 'status:in-progress', 'status:blocked']),
      'Blocked',
    );
  });

  test('закрытый issue — Done, какие бы метки ни остались', () => {
    assert.equal(desiredStatus('CLOSED', ['status:in-progress']), 'Done');
  });

  test('похожая метка не считается статусом', () => {
    assert.equal(desiredStatus('OPEN', ['status:review-later']), 'Todo');
  });
});

describe('parseSnapshot', () => {
  test('проект, поле Status, опции и карточки разбираются', () => {
    const snapshot = parseSnapshot(page({ nodes: [card(1, 'Todo'), card(2, '')] }));
    assert.equal(snapshot.projectId, 'PROJECT_ID');
    assert.equal(snapshot.statusFieldId, 'FIELD_STATUS');
    assert.deepEqual([...snapshot.options.keys()], [...COLUMNS]);
    assert.equal(snapshot.cards.get(1)?.status, 'Todo');
    assert.equal(snapshot.cards.get(2)?.status, '');
  });

  test('черновики и не-issues не попадают в карточки', () => {
    const snapshot = parseSnapshot(
      page({
        nodes: [
          { id: 'draft', content: { __typename: 'DraftIssue' }, status: null },
          { id: 'pr', content: { __typename: 'PullRequest', number: 3 }, status: null },
        ],
      }),
    );
    assert.equal(snapshot.cards.size, 0);
  });

  test('нет проекта — ошибка, а не пустой снимок', () => {
    assert.throws(
      () => parseSnapshot({ data: { repositoryOwner: { projectV2: null } } }),
      (error) => error instanceof BoardError && /проект не найден/u.test(error.message),
    );
  });

  test('нет поля Status — ошибка с подсказкой про шаблон', () => {
    assert.throws(
      () => parseSnapshot(page({ statusField: null })),
      (error) => error instanceof BoardError && /поля Status/u.test(error.message),
    );
  });
});

describe('snapshotBoard: страницы и лимиты', () => {
  test('две страницы склеиваются по курсору', () => {
    const { run, calls } = fakeGh({
      pages: [
        page({ nodes: [card(1, 'Todo')], totalCount: 2, hasNextPage: true, endCursor: 'CURSOR' }),
        page({ nodes: [card(2, 'Done')], totalCount: 2 }),
      ],
    });
    const board = snapshotBoard({ run, owner: 'octocat', number: 4, limit: 500 });
    assert.deepEqual([...board.cards.keys()], [1, 2]);
    assert.equal(calls.length, 2);
    assert.ok(calls[1]?.includes('after=CURSOR'), 'вторая страница запрошена по курсору');
    assert.ok(calls[0]?.includes(`first=${PAGE_SIZE}`), 'размер страницы — максимум GitHub');
  });

  test('карточек больше LIMIT — синк отменён с подсказкой', () => {
    const { run } = fakeGh({ pages: [page({ nodes: [card(1, 'Todo')], totalCount: 600 })] });
    assert.throws(
      () => snapshotBoard({ run, owner: 'octocat', number: 4, limit: 500 }),
      (error) =>
        error instanceof BoardError &&
        /выдача усечена/u.test(error.message) &&
        /LIMIT=700/u.test(error.message),
    );
  });

  test('страниц больше LIMIT — синк отменён, а не бесконечное чтение', () => {
    const pages = Array.from({ length: 3 }, (_, index) =>
      page({
        nodes: [card(index + 1, 'Todo')],
        totalCount: 3,
        hasNextPage: true,
        endCursor: `C${index}`,
      }),
    );
    const { run } = fakeGh({ pages });
    assert.throws(
      () => snapshotBoard({ run, owner: 'octocat', number: 4, limit: 200 }),
      (error) => error instanceof BoardError && /не дочитана/u.test(error.message),
    );
  });

  test('нет обязательной колонки — ошибка с перечнем недостающих', () => {
    const { run } = fakeGh({
      pages: [
        page({
          options: [
            { id: 'opt_todo', name: 'Todo' },
            { id: 'opt_done', name: 'Done' },
          ],
        }),
      ],
    });
    assert.throws(
      () => snapshotBoard({ run, owner: 'octocat', number: 4, limit: 500 }),
      (error) =>
        error instanceof BoardError &&
        /«In progress»/u.test(error.message) &&
        /«Review»/u.test(error.message),
    );
  });

  test('ошибка gh в контексте проекта: номер и владелец в тексте', () => {
    const run = () => {
      throw new Error('gh: Not Found (HTTP 404)\nвторая строка');
    };
    assert.throws(
      () => snapshotBoard({ run, owner: 'octocat', number: 7, limit: 500 }),
      (error) =>
        error instanceof BoardError &&
        /проект #7 у владельца octocat/u.test(error.message) &&
        !/вторая строка/u.test(error.message),
    );
  });
});

describe('readIssues', () => {
  test('issues разбираются в плоскую форму', () => {
    const { run } = fakeGh({ issues: [issue(1, 'OPEN', ['status:review'])] });
    assert.deepEqual(readIssues({ run, repo: 'acme/service', limit: 500 }), [
      {
        number: 1,
        state: 'OPEN',
        labels: ['status:review'],
        url: 'https://github.com/acme/service/issues/1',
      },
    ]);
  });

  test('issues не больше LIMIT — иначе выдача усечена', () => {
    const { run } = fakeGh({ issues: [issue(1, 'OPEN'), issue(2, 'OPEN')] });
    assert.throws(
      () => readIssues({ run, repo: 'acme/service', limit: 2 }),
      (error) => error instanceof BoardError && /выдача усечена/u.test(error.message),
    );
  });
});

describe('planSync', () => {
  test('новые карточки, переносы и неизменные считаются раздельно', () => {
    const cards = new Map([
      [1, { id: 'item_1', status: 'Todo' }],
      [2, { id: 'item_2', status: 'Todo' }],
      [3, { id: 'item_3', status: 'Todo' }],
    ]);
    const plan = planSync({
      cards,
      issues: [
        { number: 1, state: 'OPEN', labels: [], url: 'u1' },
        { number: 2, state: 'OPEN', labels: ['status:review'], url: 'u2' },
        { number: 3, state: 'CLOSED', labels: [], url: 'u3' },
        { number: 4, state: 'OPEN', labels: ['status:in-progress'], url: 'u4' },
      ],
    });

    assert.deepEqual(
      plan.adds.map((entry) => [entry.issue.number, entry.to]),
      [[4, 'In progress']],
    );
    assert.deepEqual(
      plan.moves.map((entry) => [entry.issue.number, entry.from, entry.to]),
      [
        [2, 'Todo', 'Review'],
        [3, 'Todo', 'Done'],
      ],
    );
    assert.equal(plan.unchanged, 1);
  });
});

describe('syncBoard', () => {
  /** Один и тот же набор: #1 на месте, #2 надо перенести, #3 добавить. */
  const issues = [issue(1, 'OPEN'), issue(2, 'OPEN', ['status:review']), issue(3, 'OPEN')];
  const boardPage = page({ nodes: [card(1, 'Todo'), card(2, 'Todo')], totalCount: 2 });

  test('DRY_RUN: ни одной записи, план в лог', () => {
    const { run, calls } = fakeGh({ pages: [boardPage], issues });
    /** @type {string[]} */
    const lines = [];
    const result = syncBoard({
      run,
      owner: 'octocat',
      repo: 'acme/service',
      number: 4,
      dryRun: true,
      log: (line) => lines.push(line),
    });

    assert.deepEqual(result, { added: 1, moved: 1, unchanged: 1, written: 0 });
    assert.deepEqual(writes(calls), [], 'в DRY_RUN запись в проект запрещена');
    assert.deepEqual(lines, ['перенести  #2: Todo → Review', 'добавить   #3 → Todo']);
  });

  test('новая карточка получает колонку сразу, а не со второго прогона', () => {
    const { run, calls } = fakeGh({ pages: [boardPage], issues });
    syncBoard({ run, owner: 'octocat', repo: 'acme/service', number: 4 });

    const add = calls.find((args) => args[1] === 'item-add');
    assert.ok(add, 'карточка добавлена');
    assert.ok(add.includes('--owner') && add.includes('octocat'), 'владелец передан явно');

    const edits = calls.filter((args) => args[1] === 'item-edit');
    assert.equal(edits.length, 2, 'перенос #2 + статус новой карточки #3');
    assert.ok(
      edits.every((args) => args.includes('--single-select-option-id')),
      'колонка ставится опцией поля Status',
    );
    assert.deepEqual(
      edits.map((args) => args[args.indexOf('--id') + 1]),
      ['item_2', 'item_new_3'],
    );
  });

  test('всё на месте — ни одной записи', () => {
    const { run, calls } = fakeGh({
      pages: [
        page({ nodes: [card(1, 'Todo'), card(2, 'Review'), card(3, 'Todo')], totalCount: 3 }),
      ],
      issues,
    });
    const result = syncBoard({ run, owner: 'octocat', repo: 'acme/service', number: 4 });
    assert.deepEqual(result, { added: 0, moved: 0, unchanged: 3, written: 0 });
    assert.deepEqual(writes(calls), []);
  });
});

describe('main: CLI', () => {
  /**
   * Прогон CLI с перехватом stderr: код выхода и тексты без записи в реальный вывод.
   * @param {NodeJS.ProcessEnv} env
   * @param {{ run?: (args: string[]) => string }} [deps]
   * @returns {{ code: number, lines: string[], stderr: string }}
   */
  function runMain(env, deps = {}) {
    /** @type {string[]} */
    const lines = [];
    let stderr = '';
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (/** @type {any} */ chunk) => {
      stderr += String(chunk);
      return true;
    };
    try {
      const code = main({ env, log: (line) => lines.push(line), ...deps });
      return { code, lines, stderr };
    } finally {
      process.stderr.write = original;
    }
  }

  test('PROJECT_NUMBER не задан — код 2, обращений к gh нет', () => {
    const { code, stderr } = runMain(
      {},
      {
        run: () => {
          throw new Error('gh не должен вызываться без параметров');
        },
      },
    );
    assert.equal(code, 2);
    assert.match(stderr, /PROJECT_NUMBER не задан/u);
  });

  test('мусор в PROJECT_NUMBER — код 2', () => {
    const { code, stderr } = runMain({ PROJECT_NUMBER: 'четыре' }, { run: fakeGh().run });
    assert.equal(code, 2);
    assert.match(stderr, /ожидается положительное целое/u);
  });

  test('DRY_RUN: код 0, сводка с пометкой «не выполнено»', () => {
    const { run } = fakeGh({
      pages: [page({ nodes: [card(1, 'Todo')], totalCount: 1 })],
      issues: [issue(1, 'OPEN', ['status:review'])],
    });
    const { code, lines } = runMain({ PROJECT_NUMBER: '4', DRY_RUN: '1' }, { run });
    assert.equal(code, 0);
    assert.match(lines.at(-1) ?? '', /не выполнено/u);
  });

  test('OWNER=@me резолвится через gh api user', () => {
    const { run, calls } = fakeGh({ pages: [page()], issues: [], user: { login: 'acme-bot' } });
    const owner = resolveOwner({ run, owner: '@me' });
    assert.equal(owner, 'acme-bot');
    assert.deepEqual(calls, [['api', 'user']]);
  });

  test('проект не найден — код 2, а не трассировка', () => {
    const { run } = fakeGh({
      pages: [{ data: { repositoryOwner: { projectV2: null } } }],
      issues: [],
    });
    const { code, stderr } = runMain({ PROJECT_NUMBER: '9' }, { run });
    assert.equal(code, 2);
    assert.match(stderr, /проект #9 у владельца octocat/u);
  });
});

test('скрипт исполняемый: shebang на месте (bin и workflow запускают файл напрямую)', () => {
  const source = readFileSync(new URL('./board-sync.mjs', import.meta.url), 'utf8');
  assert.match(source, /^#!\/usr\/bin\/env node\n/u);
});

describe('board-sync.yml: на каком событии выполняется сверка (issue #165)', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'board-sync.yml'), 'utf8');
  // Комментарии в workflow обсуждают правила — сравниваем только исполняемые строки.
  const LINES = WORKFLOW.split('\n').filter((line) => !line.trim().startsWith('#'));

  /**
   * Тело многострочного `if:` джобы.
   * @returns {string} строки условия без отступа
   */
  function jobIf() {
    const start = LINES.findIndex((line) => /^\s{4}if: \|$/u.test(line));
    assert.notEqual(start, -1, 'в workflow нет многострочного job-if');
    const body = [];
    for (const line of LINES.slice(start + 1)) {
      if (line.trim() === '') continue;
      if (!/^\s{6}/u.test(line)) break;
      body.push(line.trim());
    }
    return body.join('\n');
  }

  test('по имени метки не фильтрует: выживший прогон всплеска обязан отработать', () => {
    assert.doesNotMatch(
      jobIf(),
      /github\.event\.label\.name/u,
      'фильтр по метке пропускает последний выживший прогон всплеска — карточка ждёт cron',
    );
  });

  test('форк и Dependabot по-прежнему пропускаются: синк там не выполнить', () => {
    const condition = jobIf();

    assert.match(condition, /head\.repo\.full_name == github\.repository/u);
    assert.match(condition, /github\.actor != 'dependabot\[bot\]'/u);
  });

  test('события labeled/unlabeled остаются в on: иначе ручная метка не двигает доску', () => {
    assert.match(WORKFLOW, /types: \[opened, reopened, closed, labeled, unlabeled\]/u);
  });

  test('шаг сверки на месте', () => {
    assert.match(WORKFLOW, /^ *run: node tooling\/board-sync\.mjs$/mu);
  });
});
