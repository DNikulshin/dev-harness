/**
 * Тесты `tooling/check-issue-refs.mjs` (issue #147).
 *
 * Сеть в тестах не используется: резолвер номера подменяется функцией, файловая система —
 * временным каталогом. Проверяется главное свойство — «не знаю» не превращается в «зелено»:
 * недоступный `gh` даёт код `3`, а не `0`, и 404 остаётся единственным признаком мёртвого номера.
 *
 * Отдельно проверяется формат снимка: `--write-snapshot` пишет файл, который обязан быть сразу
 * отформатированным по prettier, иначе `pnpm check` краснел бы из-за правки, которую никто не
 * делал руками.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { collectRefs, refsInText } from '../scripts/lib/issue-refs.mjs';
import {
  classifyGhResult,
  DEAD,
  EXISTS,
  main,
  parseArgs,
  parseSnapshot,
  readCache,
  renderSnapshot,
  resolveRefs,
  UNKNOWN,
  wrapNumbers,
} from './check-issue-refs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Временный каталог с файлами: `{ 'путь/внутри/корня': 'содержимое' }`.
 * @param {Record<string, string>} files
 * @returns {string} корень
 */
function tempRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'harness-issue-refs-'));
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

/**
 * Запуск `main` с перехватом вывода.
 * @param {Parameters<typeof main>[0]} deps
 * @returns {{ code: number, out: string[], err: string[] }}
 */
function run(deps) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const code = main({
    log: (line) => out.push(line),
    stderr: (line) => err.push(line),
    ...deps,
  });
  return { code, out, err };
}

describe('refsInText: что считается ссылкой', () => {
  test('голый номер и повтор без дублей', () => {
    assert.deepEqual(refsInText('задача #12 и снова #12'), [12]);
    assert.deepEqual(refsInText('#12, #7'), [12, 7]);
  });

  test('hex-цвет, cross-repo ссылка и номер без решётки не считаются', () => {
    assert.deepEqual(refsInText('цвет #6b7280 в палитре'), []);
    // Шестизначные цвета из палитры отчёта: иначе каждый краснел бы как мёртвый номер.
    assert.deepEqual(refsInText('background: #111827; border-color: #374151;'), []);
    assert.deepEqual(refsInText('DNikulshin/hair-lab#233'), []);
    assert.deepEqual(refsInText('каталог 2026-11-17-178-spec-alignment'), []);
    assert.deepEqual(refsInText('§11 протокола'), []);
  });

  test('ссылка в url-фрагменте не ломает соседние номера', () => {
    assert.deepEqual(refsInText('см. #44 и ../blob/main/docs/x.md#L10'), [44]);
  });
});

describe('collectRefs: области и исключения', () => {
  test('scripts/*.mjs и docs/*.md собираются, docs/research и docs/local — нет', () => {
    const root = tempRoot({
      'scripts/a.mjs': '// см. #12\n',
      'scripts/nested/b.mjs': '// см. #13\n',
      'scripts/c.test.mjs': '// см. #14\n',
      'docs/x.md': 'см. #15\n',
      'docs/research/old.md': 'см. #99\n',
      'docs/local/journal.md': 'см. #98\n',
      'evals/seed.md': 'см. #97\n',
    });

    assert.deepEqual(collectRefs(root), [
      { ref: 15, file: 'docs/x.md', line: 1 },
      { ref: 12, file: 'scripts/a.mjs', line: 1 },
      { ref: 14, file: 'scripts/c.test.mjs', line: 1 },
      { ref: 13, file: 'scripts/nested/b.mjs', line: 1 },
    ]);
  });

  test('отсутствующая область — не ошибка', () => {
    assert.deepEqual(collectRefs(tempRoot({ 'scripts/a.mjs': 'без ссылок\n' })), []);
  });
});

describe('classifyGhResult: мёртвый номер против «не знаю»', () => {
  test('успешный ответ — номер существует', () => {
    assert.equal(classifyGhResult({ ok: true, data: 147 }), EXISTS);
  });

  test('404 — номер мёртвый, в том числе в форме gh', () => {
    assert.equal(classifyGhResult({ ok: false, reason: 'gh: Not Found (HTTP 404)' }), DEAD);
    assert.equal(classifyGhResult({ ok: false, reason: 'HTTP/2.0 404 Not Found' }), DEAD);
  });

  test('сеть, авторизация и rate limit — «не знаю», а не мёртвый номер', () => {
    const unknown = [
      'gh не установлен',
      'gh не ответил вовремя',
      'gh: API rate limit exceeded for user ID 1. (HTTP 403)',
      'gh: Bad credentials (HTTP 401)',
      'error connecting to api.github.com',
    ];
    for (const reason of unknown) assert.equal(classifyGhResult({ ok: false, reason }), UNKNOWN);
  });
});

describe('resolveRefs и кэш', () => {
  test('свежая запись кэша не требует запроса', () => {
    /** @type {number[]} */
    const calls = [];
    const results = resolveRefs([7, 8], {
      fetch: (ref) => {
        calls.push(ref);
        return EXISTS;
      },
      cache: new Map([
        [7, { state: DEAD, fetchedAt: 1000 }],
        [8, { state: EXISTS, fetchedAt: 1000 }],
      ]),
      now: 2000,
      ttlMs: 5000,
    });

    assert.deepEqual(calls, []);
    assert.deepEqual(results.get(7), { state: DEAD, cached: true });
    assert.deepEqual(results.get(8), { state: EXISTS, cached: true });
  });

  test('протухшая запись и запись из будущего резолвятся заново', () => {
    /** @type {number[]} */
    const calls = [];
    const results = resolveRefs([7, 8], {
      fetch: (ref) => {
        calls.push(ref);
        return UNKNOWN;
      },
      cache: new Map([
        [7, { state: EXISTS, fetchedAt: 0 }],
        [8, { state: EXISTS, fetchedAt: 9000 }],
      ]),
      now: 6000,
      ttlMs: 5000,
    });

    assert.deepEqual(calls, [7, 8]);
    assert.deepEqual(results.get(7), { state: UNKNOWN, cached: false });
    assert.deepEqual(results.get(8), { state: UNKNOWN, cached: false });
  });

  test('битый кэш и мусор в нём не ломают прогон', () => {
    const root = tempRoot({
      'bad.json': '{ не json',
      'mixed.json': JSON.stringify({
        12: { state: EXISTS, fetchedAt: 5 },
        13: { state: 'unknown', fetchedAt: 5 },
        14: { state: DEAD, fetchedAt: 'вчера' },
        xx: { state: DEAD, fetchedAt: 5 },
      }),
    });

    assert.equal(readCache(join(root, 'bad.json')).size, 0);
    assert.equal(readCache(join(root, 'нет-такого.json')).size, 0);
    assert.deepEqual([...readCache(join(root, 'mixed.json')).keys()], [12]);
  });
});

describe('wrapNumbers и снимок', () => {
  test('строки укладываются в printWidth 100', () => {
    const numbers = Array.from({ length: 40 }, (_, index) => 1000 + index);
    const lines = wrapNumbers(numbers).split('\n');
    assert.ok(lines.length > 1, 'длинный список должен быть разбит');
    for (const line of lines) assert.ok(line.length <= 100, `строка длиннее 100: ${line}`);
    assert.equal(lines.join(' ').split(',').length - 1, numbers.length);
  });

  test('пустой список — пустая строка', () => {
    assert.equal(wrapNumbers([]), '');
  });

  test('текущий снимок воспроизводится байт-в-байт', () => {
    const file = join(ROOT, 'scripts/dead-issue-refs.test.mjs');
    const text = readFileSync(file, 'utf8');
    const date = text.match(/const SNAPSHOT_DATE = '([^']*)';/u)?.[1];
    const maxRef = text.match(/const MAX_REF_AT_SNAPSHOT = (\d+);/u)?.[1];
    const list = text.match(/const DEAD_REFS = Object\.freeze\(\[([\s\S]*?)\]\);/u)?.[1] ?? '';
    const deadRefs = [...list.matchAll(/\d+/gu)].map((match) => Number(match[0]));

    assert.ok(date !== undefined && maxRef !== undefined && deadRefs.length > 0);
    assert.equal(
      renderSnapshot({ text, date, deadRefs, maxRef: Number(maxRef) }),
      text,
      'формат снимка должен совпадать с тем, что пишет prettier',
    );
  });

  test('снимок обновляет дату, максимум и список', () => {
    const text = readFileSync(join(ROOT, 'scripts/dead-issue-refs.test.mjs'), 'utf8');
    const next = renderSnapshot({ text, date: '2026-12-01', deadRefs: [160, 153], maxRef: 150 });

    assert.match(next, /const SNAPSHOT_DATE = '2026-12-01';/u);
    assert.match(next, /const MAX_REF_AT_SNAPSHOT = 150;/u);
    assert.match(next, /const DEAD_REFS = Object\.freeze\(\[\n {2}153, 160,\n\]\);/u);
  });

  test('пустой снимок — пустой массив, а не пустые строки', () => {
    const text = readFileSync(join(ROOT, 'scripts/dead-issue-refs.test.mjs'), 'utf8');
    const next = renderSnapshot({ text, date: '2026-12-01', deadRefs: [], maxRef: 150 });
    assert.match(next, /const DEAD_REFS = Object\.freeze\(\[\]\);/u);
  });

  test('несовпадение шаблона — исключение, а не тихая запись', () => {
    assert.throws(() =>
      renderSnapshot({ text: 'ничего', date: '2026-12-01', deadRefs: [], maxRef: 1 }),
    );
  });
});

describe('parseArgs', () => {
  test('флаги и ошибка на неизвестном', () => {
    assert.deepEqual(parseArgs([]), { writeSnapshot: false, noCache: false });
    assert.deepEqual(parseArgs(['--write-snapshot', '--no-cache']), {
      writeSnapshot: true,
      noCache: true,
    });
    assert.equal(parseArgs(['--write-snaphsot']).error !== undefined, true);
  });
});

describe('main: коды выхода', () => {
  test('все номера существуют — 0 и кэш записан', () => {
    const root = tempRoot({ 'scripts/a.mjs': '// см. #12\n' });
    const { code, out, err } = run({
      root,
      argv: [],
      env: { REPO: 'acme/service' },
      fetchRef: () => EXISTS,
      now: () => 1_000,
    });

    assert.equal(code, 0, err.join('\n'));
    assert.match(out.join('\n'), /все 1 номеров существуют/u);
    const cache = readCache(join(root, '.cache/issue-refs.json'));
    assert.deepEqual(cache.get(12), { state: EXISTS, fetchedAt: 1_000 });
  });

  test('мёртвый номер — 2, адрес и аннотация в stderr', () => {
    const root = tempRoot({ 'scripts/a.mjs': '// см. #12\n', 'docs/x.md': 'и #13\n' });
    const { code, err } = run({
      root,
      argv: ['--no-cache'],
      env: { REPO: 'acme/service' },
      fetchRef: (ref) => (ref === 13 ? DEAD : EXISTS),
    });

    assert.equal(code, 2);
    assert.ok(err.includes('docs/x.md:1: #13'), err.join('\n'));
    assert.ok(
      err.some((line) => line.startsWith('::error::')),
      err.join('\n'),
    );
    assert.equal(
      existsSync(join(root, '.cache/issue-refs.json')),
      false,
      '--no-cache не пишет кэш',
    );
  });

  test('непроверенные номера — 3, а не зелёный прогон', () => {
    const root = tempRoot({ 'scripts/a.mjs': '// см. #12\n' });
    const { code, err } = run({
      root,
      argv: ['--no-cache'],
      env: { REPO: 'acme/service' },
      fetchRef: () => UNKNOWN,
    });

    assert.equal(code, 3);
    assert.ok(
      err.some((line) => line.startsWith('::warning::')),
      err.join('\n'),
    );
  });

  test('неизвестный репозиторий — 3 без запросов', () => {
    const root = tempRoot({ 'scripts/a.mjs': '// см. #12\n' });
    let calls = 0;
    const { code, err } = run({
      root,
      argv: ['--no-cache'],
      env: {},
      api: () => {
        calls += 1;
        return { ok: false, reason: 'gh не установлен' };
      },
    });

    assert.equal(code, 3);
    assert.equal(calls, 1, 'должен быть один запрос — только за именем репозитория');
    assert.ok(err.join('\n').includes('репозиторий не определён'));
  });

  test('нет ссылок — 0 без обращения к сети', () => {
    const root = tempRoot({ 'scripts/a.mjs': 'без ссылок\n' });
    const { code } = run({
      root,
      argv: [],
      env: {},
      fetchRef: () => {
        throw new Error('сеть не должна вызываться');
      },
    });
    assert.equal(code, 0);
  });

  test('неизвестный флаг — 1 и подсказка', () => {
    const root = tempRoot({ 'scripts/a.mjs': '// см. #12\n' });
    const { code, err } = run({ root, argv: ['--всё-сразу'], env: {} });
    assert.equal(code, 1);
    assert.ok(err.join('\n').includes('Использование'));
  });
});

describe('parseSnapshot', () => {
  test('дата, максимум и список разбираются', () => {
    const text = readFileSync(join(ROOT, 'scripts/dead-issue-refs.test.mjs'), 'utf8');
    const snapshot = parseSnapshot(text);
    assert.match(snapshot.date, /^\d{4}-\d{2}-\d{2}$/u);
    assert.ok(Number.isInteger(snapshot.maxRef));
    assert.ok(snapshot.deadRefs.length > 0);
    assert.deepEqual(
      snapshot.deadRefs,
      [...snapshot.deadRefs].sort((left, right) => left - right),
      'список в файле отсортирован',
    );
  });

  test('чужая структура — исключение', () => {
    assert.throws(() => parseSnapshot('ничего'));
  });
});

describe('main --write-snapshot', () => {
  /** Минимальный снимок той же формы, что и настоящий тест: номера в нём под контролем. */
  const SNAPSHOT_FIXTURE = [
    "const SNAPSHOT_DATE = '2026-11-21';",
    'const MAX_REF_AT_SNAPSHOT = 142;',
    'const DEAD_REFS = Object.freeze([',
    '  153, 154,',
    ']);',
    '',
  ].join('\n');

  test('снимок переписывается и не теряет прошлые записи', () => {
    const root = tempRoot({
      'scripts/dead-issue-refs.test.mjs': SNAPSHOT_FIXTURE,
      'scripts/a.mjs': '// см. #142\n',
    });

    const { code, out } = run({
      root,
      argv: ['--write-snapshot', '--no-cache'],
      env: { REPO: 'acme/service' },
      fetchRef: (ref) => (ref === 142 ? EXISTS : DEAD),
      now: () => Date.parse('2026-12-01T00:00:00Z'),
    });

    assert.equal(code, 0, out.join('\n'));
    const written = readFileSync(join(root, 'scripts/dead-issue-refs.test.mjs'), 'utf8');
    assert.match(written, /const SNAPSHOT_DATE = '2026-12-01';/u);
    assert.match(written, /const MAX_REF_AT_SNAPSHOT = 142;/u);
    assert.match(written, /const DEAD_REFS = Object\.freeze\(\[\n {2}153, 154,\n\]\);/u);
    assert.match(out.join('\n'), /снимок scripts\/dead-issue-refs\.test\.mjs обновлён/u);
  });

  test('мёртвый номер не выше максимума — снимок не пишется', () => {
    const root = tempRoot({
      'scripts/dead-issue-refs.test.mjs': SNAPSHOT_FIXTURE,
      'scripts/a.mjs': '// см. #12 и #13\n',
    });

    const { code, err } = run({
      root,
      argv: ['--write-snapshot', '--no-cache'],
      env: { REPO: 'acme/service' },
      fetchRef: (ref) => (ref === 13 ? EXISTS : DEAD),
      now: () => Date.parse('2026-12-01T00:00:00Z'),
    });

    assert.equal(code, 2);
    assert.ok(err.join('\n').includes('снимок не записан'), err.join('\n'));
    assert.equal(
      readFileSync(join(root, 'scripts/dead-issue-refs.test.mjs'), 'utf8'),
      SNAPSHOT_FIXTURE,
    );
  });
});
