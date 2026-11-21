import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  aggregateGates,
  barPercent,
  buildReport,
  collectStopArtifacts,
  escapeHtml,
  lastIterationFile,
  listArtifactDirs,
  listCycleDirs,
  median,
  parseArgs,
  percent,
  renderHtml,
  renderMarkdown,
  summarizeContext,
  summarizeCycle,
  summarizePending,
  summarizeStop,
} from './cycle-report.mjs';

/** Путь к CLI: сквозные тесты запускают его отдельным процессом. */
const SCRIPT = fileURLToPath(new URL('./cycle-report.mjs', import.meta.url));

/** Корень фикстур метрик: `scripts/fixtures/cycle/metrics/`. */
const METRICS_FIXTURES = fileURLToPath(new URL('./fixtures/cycle/metrics/', import.meta.url));

/** Корень фикстур артефактов цикла: `scripts/fixtures/cycle/`. */
const CYCLE_FIXTURES = fileURLToPath(new URL('./fixtures/cycle/', import.meta.url));

/**
 * Фикстура артефакта цикла по имени файла (`decision.valid.json`, `state.valid.json`, …).
 * @param {string} name
 * @returns {Record<string, any>}
 */
function fixture(name) {
  return JSON.parse(readFileSync(join(CYCLE_FIXTURES, name), 'utf8'));
}

/** Валидный `metrics.json` фикстуры: база для вариантов в тестах. */
function metricsDoc(overrides = {}) {
  const base = JSON.parse(readFileSync(join(METRICS_FIXTURES, 'metrics.valid.json'), 'utf8'));
  return { ...base, ...overrides };
}

/**
 * Временный каталог артефактов.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function makeDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Кладёт `metrics.json` в подкаталог цикла.
 * @param {string} dir каталог артефактов
 * @param {string} name имя цикла
 * @param {Record<string, any>} doc
 * @returns {string} путь к каталогу цикла
 */
function writeCycle(dir, name, doc) {
  const cycleDir = join(dir, name);
  mkdirSync(cycleDir, { recursive: true });
  writeFileSync(join(cycleDir, 'metrics.json'), `${JSON.stringify(doc, null, 2)}\n`);
  return cycleDir;
}

/**
 * Запускает CLI как отдельный процесс.
 * @param {string[]} args
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('cycle-report: median и percent', () => {
  test('медиана нечётного и чётного списка, пустой — null', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([4.72, 21.36]), 13.04);
    assert.equal(median([]), null);
    assert.equal(median(null), null);
  });

  test('percent: делить не на что — null, иначе одна цифра после запятой', () => {
    assert.equal(percent(1, 4), 25);
    assert.equal(percent(1, 3), 33.3);
    assert.equal(percent(0, 0), null);
  });
});

describe('cycle-report: сводка по метрикам', () => {
  test('summarizeCycle берёт факты и не выдумывает отсутствующие поля', () => {
    const summary = summarizeCycle(
      '2026-11-17-108-confirmation-url',
      metricsDoc({ cost_rub: 4.72 }),
    );

    assert.equal(summary.name, '2026-11-17-108-confirmation-url');
    assert.equal(summary.final_stage, 'DONE');
    assert.equal(summary.iterations, 2);
    assert.equal(summary.cost_rub, 4.72);
    assert.deepEqual(summary.findings, { only_review: 4, only_evaluator: 2, both: 2 });
    assert.deepEqual(summary.evaluator_defects, { BLOCKER: 1, MAJOR: 2, MINOR: 1 });

    const sparse = summarizeCycle('x', {
      final_stage: 'ESCALATED',
      iterations: 1,
      max_iterations: 2,
    });
    assert.equal(sparse.cost_rub, null, 'нет замера — null, а не ноль');
    assert.equal(sparse.duration_s, undefined);
    assert.deepEqual(sparse.findings, { only_review: 0, only_evaluator: 0, both: 0 });
    assert.deepEqual(sparse.evaluator_defects, { BLOCKER: 0, MAJOR: 0, MINOR: 0 });
    assert.equal(sparse.unresolved_refs, 0);
  });

  test('buildReport: сумма и медиана — только по циклам с расходом', () => {
    const cycles = [
      summarizeCycle(
        'a',
        metricsDoc({ cost_rub: 4.72, only_review: 0, only_evaluator: 3, both: 0 }),
      ),
      summarizeCycle(
        'b',
        metricsDoc({ cost_rub: 21.36, only_review: 1, only_evaluator: 0, both: 1 }),
      ),
      summarizeCycle(
        'c',
        metricsDoc({ cost_rub: null, only_review: 0, only_evaluator: 0, both: 0 }),
      ),
    ];

    const report = buildReport(cycles, { skipped: 5 });

    assert.deepEqual(report.cost, { measured: 2, total: 3, sum: 26.08, median: 13.04 });
    assert.deepEqual(report.findings, { evaluator_only: 3, total: 5, percent: 60 });
    assert.equal(report.skipped, 5);
  });

  test('buildReport без расходов: сумма и медиана — null, а не 0', () => {
    const report = buildReport([
      summarizeCycle(
        'a',
        metricsDoc({ cost_rub: null, only_review: 0, only_evaluator: 0, both: 0 }),
      ),
    ]);

    assert.deepEqual(report.cost, { measured: 0, total: 1, sum: null, median: null });
    assert.deepEqual(report.findings, { evaluator_only: 0, total: 0, percent: null });
  });

  test('aggregateGates суммирует исходы, порядок — таблица §5.5, затем алфавит', () => {
    const cycles = [
      summarizeCycle(
        'a',
        metricsDoc({ gate_outcomes: { zz_custom: { pass: 1 }, lint: { fail: 2 } } }),
      ),
      summarizeCycle(
        'b',
        metricsDoc({ gate_outcomes: { lint: { pass: 1 }, aa_custom: { not_run: 3 } } }),
      ),
    ];

    assert.deepEqual(aggregateGates(cycles, ['contracts_build', 'typecheck', 'lint']), [
      { id: 'lint', pass: 1, fail: 2, skipped: 0, not_run: 0 },
      { id: 'aa_custom', pass: 0, fail: 0, skipped: 0, not_run: 3 },
      { id: 'zz_custom', pass: 1, fail: 0, skipped: 0, not_run: 0 },
    ]);
  });
});

describe('cycle-report: markdown', () => {
  test('шапка с итогами, строка на цикл и таблица гейтов', () => {
    const report = buildReport(
      [summarizeCycle('2026-11-17-108-confirmation-url', metricsDoc({ cost_rub: 4.72 }))],
      { gateIds: ['contracts_build', 'typecheck', 'lint'] },
    );
    const text = renderMarkdown(report);

    assert.match(text, /^# Отчёт по циклам\n/u);
    assert.ok(text.includes('Циклов: 1, с расходом: 1. Расход: 4.72 ₽, медиана: 4.72 ₽.'));
    assert.ok(text.includes('| 2026-11-17-108-confirmation-url | DONE | 2/2 |'));
    assert.ok(text.includes('| contracts_build | 2 | 0 | 0 | 0 |'));
    assert.ok(text.endsWith('\n'), 'вывод завершается переводом строки');
  });

  test('нет циклов — честное сообщение, а не пустая таблица', () => {
    const text = renderMarkdown(buildReport([], { skipped: 7 }));

    assert.ok(text.includes('Циклов с `metrics.json` нет'));
    assert.ok(text.includes('Пропущено каталогов без `state.json` и `metrics.json`: 7.'));
    assert.ok(!text.includes('| Цикл |'));
  });
});

describe('cycle-report: html', () => {
  /** Отчёт из одного цикла с расходом — база для вариантов. */
  function oneCycle(overrides = {}) {
    return buildReport([summarizeCycle('2026-11-17-108-confirmation-url', metricsDoc(overrides))], {
      gateIds: ['contracts_build', 'typecheck', 'lint'],
    });
  }

  test('самодостаточная страница: doctype, язык, стили внутри, без внешних ресурсов', () => {
    const html = renderHtml(oneCycle({ cost_rub: 4.72 }));

    assert.match(html, /^<!doctype html>\n<html lang="ru">/u);
    assert.match(html, /<meta charset="utf-8">/u);
    assert.ok(html.includes('<style>'), 'стили внутри документа');
    assert.ok(!html.includes('http://') && !html.includes('https://'), 'ни одного внешнего URL');
    assert.ok(!html.includes('<script'), 'без JS');
    assert.ok(!html.includes('<link'), 'без внешних стилей и шрифтов');
    assert.ok(html.endsWith('\n'), 'вывод завершается переводом строки');
  });

  test('те же факты, что в markdown: итоги, строка цикла, таблица гейтов', () => {
    const html = renderHtml(oneCycle({ cost_rub: 4.72 }));

    assert.ok(html.includes('Циклов: 1, с расходом: 1. Расход: 4.72 ₽, медиана: 4.72 ₽.'));
    assert.ok(html.includes('2026-11-17-108-confirmation-url'));
    assert.ok(html.includes('<th scope="col">Расход, ₽</th>'));
    assert.ok(html.includes('<td>4.72</td>'));
    assert.ok(html.includes('contracts_build'));
    assert.ok(html.includes('Расход по циклам'), 'полоски расхода');
    assert.ok(html.includes('style="width: 100%"'), 'единственный замер — полная полоска');
  });

  test('имена каталогов и id гейтов экранируются', () => {
    const report = buildReport([summarizeCycle('a<b>&"c\'d', metricsDoc({ cost_rub: 1 }))], {
      gateIds: [],
    });
    const html = renderHtml(report);

    assert.ok(html.includes('a&lt;b&gt;&amp;&quot;c&#39;d'));
    assert.ok(!html.includes('a<b>&'), 'сырой текст имени не попадает в разметку');
    assert.equal(escapeHtml('<&>"\''), '&lt;&amp;&gt;&quot;&#39;');
  });

  test('пустой отчёт — честная страница без таблиц', () => {
    const html = renderHtml(buildReport([], { skipped: 7 }));

    assert.ok(html.includes('Циклов с <code>metrics.json</code> нет'));
    assert.ok(
      html.includes(
        'Пропущено каталогов без <code>state.json</code> и <code>metrics.json</code>: 7.',
      ),
    );
    assert.ok(!html.includes('<table>'), 'пустых таблиц нет');
  });

  test('полоски считаются от максимума в отчёте и детерминированы', () => {
    const report = buildReport([
      summarizeCycle('a', metricsDoc({ cost_rub: 10 })),
      summarizeCycle('b', metricsDoc({ cost_rub: 5 })),
    ]);
    const html = renderHtml(report);

    assert.ok(html.includes('style="width: 100%"'));
    assert.ok(html.includes('style="width: 50%"'));
    assert.equal(barPercent(5, 10), 50);
    assert.equal(barPercent(1, 3), 33.3);
    assert.equal(barPercent(1, 0), 0);
    assert.equal(html, renderHtml(report), 'два вызова дают побайтно равную страницу');
  });
});

describe('cycle-report: незавершённые циклы и причины остановки', () => {
  /** Незавершённый цикл из фикстуры состояния. */
  function pendingCycle(overrides = {}) {
    return summarizePending('2026-11-17-108-confirmation-url', {
      ...fixture('state.valid.json'),
      stage: 'CODING_WAIT',
      stage_status: 'running',
      retries: { REVIEW: 1, EVALUATE: 2, evidence: 0 },
      updated_at: '2026-11-20T21:00:00Z',
      ...overrides,
    });
  }

  /** Причина остановки из фикстур решения, оценки, эскалации и гейтов. */
  function stoppedCycle(overrides = {}) {
    return summarizeStop('2026-11-16-188-health-db', {
      decision: fixture('decision.valid.json'),
      evaluation: fixture('evaluation.valid.json'),
      escalation: fixture('escalation.valid.json'),
      gates: fixture('gates.valid.json'),
      ...overrides,
    });
  }

  /** Гейты последней итерации, где `contracts_build` упал: нужен для разделения fail и not_run. */
  function gatesWithFail() {
    const raw = fixture('gates.valid.json');
    /** @type {{ id: string }[]} */
    const rows = raw.gates;
    return {
      ...raw,
      gates: rows.map((gate) =>
        gate.id === 'contracts_build' ? { ...gate, status: 'fail', exit: 1 } : gate,
      ),
    };
  }

  test('summarizePending берёт стадию, статус, итерацию, время и повторы', () => {
    assert.deepEqual(pendingCycle(), {
      name: '2026-11-17-108-confirmation-url',
      stage: 'CODING_WAIT',
      stage_status: 'running',
      iteration: 1,
      max_iterations: 2,
      updated_at: '2026-11-20T21:00:00Z',
      retries: { REVIEW: 1, EVALUATE: 2, evidence: 0 },
    });

    const bare = summarizePending('x', {
      stage: 'PLAN',
      stage_status: 'error',
      iteration: 1,
      max_iterations: 2,
      updated_at: 'T',
    });
    assert.deepEqual(bare.retries, { REVIEW: 0, EVALUATE: 0, evidence: 0 }, 'нет счётчиков — нули');
  });

  test('summarizeStop: вердикт, причины, эскалация, критерии не met и гейты', () => {
    const stop = stoppedCycle();

    assert.equal(stop.action, 'REWORK');
    assert.deepEqual(stop.reasons, [
      'gate:typecheck: fail',
      'review:BLOCKER R1',
      'review:MAJOR R2',
    ]);
    assert.deepEqual(stop.unverified, ['test_int not_run (no_database)']);
    assert.deepEqual(stop.escalation, {
      reason: 'iteration_limit',
      detail: 'Две итерации исчерпаны, остаётся BLOCKER R1',
    });
    assert.deepEqual(stop.criteria, [
      { id: 'C2', status: 'partial' },
      { id: 'C3', status: 'unverified' },
    ]);
    assert.deepEqual(stop.gates, [
      { id: 'typecheck', status: 'not_run', reason: 'blocked_by:contracts_build' },
      { id: 'test_int', status: 'not_run', reason: 'no_database' },
    ]);
    assert.deepEqual(stop.missing, []);
    assert.equal(stop.insufficient, false);
  });

  test('summarizeStop: ни решения, ни эскалации — insufficient_data, а не догадка', () => {
    const stop = summarizeStop('z', {
      decision: null,
      evaluation: null,
      escalation: null,
      gates: null,
    });

    assert.equal(stop.insufficient, true);
    assert.equal(stop.action, null);
    assert.deepEqual(stop.missing, ['decision', 'escalation', 'gates']);
    assert.deepEqual(stop.gates, []);
  });

  test('summarizeStop: эскалация без решения объясняет остановку', () => {
    const stop = stoppedCycle({ decision: null, evaluation: null, gates: null });

    assert.equal(stop.insufficient, false);
    assert.deepEqual(stop.missing, ['decision', 'gates']);
    assert.equal(stop.escalation?.reason, 'iteration_limit');
    assert.deepEqual(stop.criteria, [], 'без решения чужие критерии не подставляются');
  });

  test('markdown: незавершённые циклы таблицей, а не счётчиком', () => {
    const text = renderMarkdown(buildReport([], { skipped: 2, pending: [pendingCycle()] }));

    assert.match(text, /## Незавершённые циклы/u);
    assert.ok(
      text.includes(
        '| 2026-11-17-108-confirmation-url | CODING_WAIT | running | 1/2' +
          ' | 2026-11-20T21:00:00Z | 1/2/0 |',
      ),
    );
    assert.ok(text.includes('Циклов с `metrics.json` нет'), 'блок есть и без циклов с метриками');
  });

  test('markdown: fail, not_run с причиной и insufficient_data — разные строки', () => {
    const text = renderMarkdown(
      buildReport([], { stops: [stoppedCycle({ gates: gatesWithFail() })] }),
    );

    assert.ok(text.includes('- Гейты fail: contracts_build'), 'fail отдельной строкой');
    assert.ok(
      text.includes(
        '- Гейты not_run: typecheck (blocked_by:contracts_build), test_int (no_database)',
      ),
      'у not_run видна причина',
    );
    assert.ok(
      text.includes('- Критерии не met: C2 partial; C3 unverified'),
      'id критериев на месте',
    );
    assert.ok(
      !text.includes('insufficient_data'),
      'объяснённый цикл не помечается недостатком данных',
    );

    const silent = renderMarkdown(
      buildReport([], {
        stops: [
          summarizeStop('z', {
            decision: null,
            evaluation: null,
            escalation: null,
            gates: null,
          }),
        ],
      }),
    );
    assert.ok(
      silent.includes(
        '- insufficient_data: нет decision.<n>.json, escalation.json, gates.<n>.json',
      ),
      'нет данных — отдельная строка, а не молчание',
    );
  });

  test('html: блоки незавершённых и причин остановки, без JS и внешних ресурсов', () => {
    const report = buildReport([], {
      pending: [pendingCycle()],
      stops: [
        stoppedCycle({ gates: gatesWithFail() }),
        summarizeStop('silent', {
          decision: null,
          evaluation: null,
          escalation: null,
          gates: null,
        }),
      ],
    });
    const html = renderHtml(report);

    assert.ok(html.includes('<h2>Незавершённые циклы</h2>'));
    assert.ok(html.includes('2026-11-17-108-confirmation-url'));
    assert.ok(html.includes('<h2>Почему остановились</h2>'));
    assert.ok(html.includes('<li class="fail">'), 'fail');
    assert.ok(html.includes('<li class="not-run">'), 'not_run с причиной');
    assert.ok(html.includes('<li class="insufficient">'), 'insufficient_data');
    assert.ok(html.includes('test_int (no_database)'));
    assert.ok(!html.includes('<script'), 'без JS');
    assert.ok(!html.includes('http://') && !html.includes('https://'), 'ни одного внешнего URL');
    assert.ok(!html.includes('<link'), 'без внешних стилей и шрифтов');
    assert.equal(html, renderHtml(report), 'два вызова дают побайтно равную страницу');
  });

  test('html: имена циклов в новых блоках экранируются', () => {
    const html = renderHtml(
      buildReport([], {
        pending: [summarizePending('<img src=x>', fixture('state.valid.json'))],
        stops: [
          summarizeStop('<script>alert(1)</script>', {
            decision: null,
            evaluation: null,
            escalation: null,
            gates: null,
          }),
        ],
      }),
    );

    assert.ok(html.includes('&lt;img src=x&gt;'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<img') && !html.includes('<script'), 'сырой разметки нет');
  });

  test('lastIterationFile берёт максимальный номер и не путается в мусоре', (t) => {
    const dir = makeDir(t);
    mkdirSync(join(dir, 'cycle'), { recursive: true });
    for (const name of [
      'decision.1.json',
      'decision.2.json',
      'decision.10.json',
      'decision.json',
    ]) {
      writeFileSync(join(dir, 'cycle', name), '{}\n');
    }

    assert.deepEqual(lastIterationFile(join(dir, 'cycle'), 'decision'), {
      iteration: 10,
      fileName: 'decision.10.json',
    });
    assert.equal(lastIterationFile(join(dir, 'cycle'), 'gates'), null);
  });
});

describe('cycle-report: CLI', () => {
  test('читает metrics.json каталогов и печатает отчёт детерминированно', (t) => {
    const dir = makeDir(t);
    writeCycle(
      dir,
      '2026-11-16-188-health-db',
      metricsDoc({ cost_rub: null, final_stage: 'ESCALATED' }),
    );
    writeCycle(dir, '2026-11-17-108-confirmation-url', metricsDoc({ cost_rub: 4.72 }));
    mkdirSync(join(dir, 'no-metrics'), { recursive: true });
    mkdirSync(join(dir, 'evals'), { recursive: true });

    const first = runCli(['--dir', dir]);
    const second = runCli(['--dir', dir]);

    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout, 'два прогона дают побайтно равный отчёт');
    assert.ok(first.stdout.includes('Циклов: 2, с расходом: 1.'));
    assert.ok(first.stdout.includes('Пропущено каталогов без `state.json` и `metrics.json`: 2.'));
    assert.ok(
      first.stdout.indexOf('2026-11-16-188-health-db') <
        first.stdout.indexOf('2026-11-17-108-confirmation-url'),
      'каталоги идут по имени',
    );
  });

  test('--json отдаёт тот же отчёт структурой', (t) => {
    const dir = makeDir(t);
    writeCycle(dir, 'a', metricsDoc({ cost_rub: 4.72 }));

    const result = runCli(['--dir', dir, '--json']);

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.cycles.length, 1);
    assert.deepEqual(report.cost, { measured: 1, total: 1, sum: 4.72, median: 4.72 });
    assert.ok(Array.isArray(report.gates));
  });

  test('--html печатает страницу в stdout и ничего не пишет на диск', (t) => {
    const dir = makeDir(t);
    writeCycle(dir, '2026-11-17-108-confirmation-url', metricsDoc({ cost_rub: 4.72 }));
    const before = readdirSync(dir).sort();

    const first = runCli(['--dir', dir, '--html']);
    const second = runCli(['--dir', dir, '--html']);

    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^<!doctype html>/u);
    assert.ok(first.stdout.includes('Циклов: 1, с расходом: 1.'));
    assert.equal(first.stdout, second.stdout, 'два прогона дают побайтно равную страницу');
    assert.deepEqual(readdirSync(dir).sort(), before, 'в каталоге артефактов ничего не появилось');
  });

  test('--html и --json вместе — код 2: формат выбирает человек', (t) => {
    const dir = makeDir(t);
    writeCycle(dir, 'a', metricsDoc());

    const result = runCli(['--dir', dir, '--html', '--json']);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--json и --html взаимоисключающие/u);
  });

  test('битый metrics.json — код 2 с именем каталога, а не молчаливый пропуск', (t) => {
    const dir = makeDir(t);
    const cycleDir = writeCycle(dir, 'broken', metricsDoc());
    writeFileSync(join(cycleDir, 'metrics.json'), '{"iterations": \n');

    const result = runCli(['--dir', dir]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /^cycle-report: broken\/metrics\.json: не читается/u);
    assert.equal(result.stdout, '');
  });

  test('metrics.json с нарушенной схемой — код 2 с диагностикой', (t) => {
    const dir = makeDir(t);
    writeCycle(dir, 'bad-schema', metricsDoc({ iterations: 0 }));

    const result = runCli(['--dir', dir]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /bad-schema\/metrics\.json: схема нарушена/u);
  });

  test('нет каталога артефактов и мусор в аргументах — код 2', (t) => {
    const dir = makeDir(t);

    const missing = runCli(['--dir', join(dir, 'nope')]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /каталог артефактов не найден/u);

    for (const args of [['--unknown'], ['--dir']]) {
      const result = runCli(args);
      assert.equal(result.status, 2, args.join(' '));
      assert.notEqual(result.stderr, '');
    }
  });

  test('parseArgs: --dir, --json, --html, мусор — исключение', () => {
    assert.deepEqual(parseArgs([]), { dir: null, json: false, html: false });
    assert.deepEqual(parseArgs(['--dir', 'D', '--json']), { dir: 'D', json: true, html: false });
    assert.deepEqual(parseArgs(['--html']), { dir: null, json: false, html: true });
    assert.throws(() => parseArgs(['--dir']), /--dir: ожидается путь/u);
    assert.throws(() => parseArgs(['--json', '--wat']), /неизвестный аргумент/u);
    assert.throws(() => parseArgs(['--html', '--json']), /взаимоисключающие/u);
  });

  test('listCycleDirs: только подкаталоги с metrics.json, по имени', (t) => {
    const dir = makeDir(t);
    writeCycle(dir, 'b', metricsDoc());
    writeCycle(dir, 'a', metricsDoc());
    mkdirSync(join(dir, 'c'), { recursive: true });
    writeFileSync(join(dir, 'metrics.json'), '{}\n');

    assert.deepEqual(listCycleDirs(dir), ['a', 'b']);
    assert.deepEqual(listArtifactDirs(dir), ['a', 'b', 'c'], 'все подкаталоги, по имени');
  });

  test('застрявший цикл: отчёт отвечает «где и почему встал» без заглядывания в JSON', (t) => {
    const dir = makeDir(t);
    const done = writeCycle(dir, '2026-11-16-188-health-db', metricsDoc({ cost_rub: 4.72 }));
    /** @type {[string, Record<string, any>][]} */
    const artifacts = [
      ['decision.1.json', fixture('decision.valid.json')],
      ['evaluation.1.json', fixture('evaluation.valid.json')],
      ['gates.1.json', fixture('gates.valid.json')],
      ['escalation.json', fixture('escalation.valid.json')],
    ];
    for (const [name, doc] of artifacts) {
      writeFileSync(join(done, name), `${JSON.stringify(doc, null, 2)}\n`);
    }

    const stuck = join(dir, '2026-11-17-108-confirmation-url');
    mkdirSync(stuck, { recursive: true });
    writeFileSync(
      join(stuck, 'state.json'),
      `${JSON.stringify(
        {
          ...fixture('state.valid.json'),
          stage: 'ESCALATED',
          stage_status: 'done',
          retries: { REVIEW: 1, EVALUATE: 2, evidence: 0 },
          escalation: {
            reason: 'iteration_limit',
            detail: 'Две итерации исчерпаны',
            draft_pr_allowed: false,
          },
          updated_at: '2026-11-20T21:00:00Z',
        },
        null,
        2,
      )}\n`,
    );
    mkdirSync(join(dir, 'evals'), { recursive: true });

    const first = runCli(['--dir', dir]);
    const second = runCli(['--dir', dir]);

    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout, 'два прогона дают побайтно равный отчёт');
    assert.ok(first.stdout.includes('Пропущено каталогов без `state.json` и `metrics.json`: 1.'));
    assert.match(first.stdout, /## Незавершённые циклы/u);
    assert.ok(
      first.stdout.includes(
        '| 2026-11-17-108-confirmation-url | ESCALATED | done | 1/2' +
          ' | 2026-11-20T21:00:00Z | 1/2/0 |',
      ),
      'стадия, статус, итерация, время и повторы видны в таблице',
    );
    assert.match(first.stdout, /### 2026-11-16-188-health-db/u);
    assert.ok(first.stdout.includes('- Вердикт: REWORK'));
    assert.ok(
      first.stdout.includes('- Причины: gate:typecheck: fail; review:BLOCKER R1; review:MAJOR R2'),
    );
    assert.ok(first.stdout.includes('- Гейты not_run: typecheck (blocked_by:contracts_build)'));
    assert.ok(first.stdout.includes('- Критерии не met: C2 partial; C3 unverified'));
    assert.ok(
      first.stdout.includes('- Эскалация: iteration_limit — Две итерации исчерпаны'),
      'причина из state.escalation, когда escalation.json нет',
    );
    assert.ok(
      first.stdout.indexOf('### 2026-11-16-188-health-db') <
        first.stdout.indexOf('### 2026-11-17-108-confirmation-url'),
      'причины идут по имени каталога',
    );
  });

  test('--html на дереве с застрявшим циклом: те же факты без JS и сети', (t) => {
    const dir = makeDir(t);
    const stuck = join(dir, 'a-stuck');
    mkdirSync(stuck, { recursive: true });
    writeFileSync(join(stuck, 'state.json'), `${JSON.stringify(fixture('state.valid.json'))}\n`);

    const first = runCli(['--dir', dir, '--html']);
    const second = runCli(['--dir', dir, '--html']);

    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout, 'два прогона дают побайтно равную страницу');
    assert.ok(first.stdout.includes('<h2>Незавершённые циклы</h2>'));
    assert.ok(first.stdout.includes('a-stuck'));
    assert.ok(!first.stdout.includes('<script'), 'без JS');
    assert.ok(!/\s(?:src|href)="/u.test(first.stdout), 'ни одного внешнего src/href');
    assert.ok(!first.stdout.includes('http://') && !first.stdout.includes('https://'));
  });

  test('битый state.json и битый decision — код 2 с именем каталога', (t) => {
    const dir = makeDir(t);
    const broken = join(dir, 'broken');
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, 'state.json'), '{ "stage": }\n');

    const state = runCli(['--dir', dir]);
    assert.equal(state.status, 2);
    assert.match(state.stderr, /^cycle-report: broken\/state\.json: не читается/u);

    writeFileSync(join(broken, 'state.json'), `${JSON.stringify(fixture('state.valid.json'))}\n`);
    writeFileSync(join(broken, 'decision.1.json'), '{ "action": }\n');
    writeFileSync(join(broken, 'metrics.json'), `${JSON.stringify(metricsDoc())}\n`);

    const decision = runCli(['--dir', dir]);
    assert.equal(decision.status, 2);
    assert.match(decision.stderr, /^cycle-report: broken\/decision\.1\.json: не читается/u);
    assert.equal(decision.stdout, '');
  });

  test('collectStopArtifacts: критерии берутся из оценки той же итерации', (t) => {
    const dir = makeDir(t);
    writeFileSync(
      join(dir, 'decision.2.json'),
      `${JSON.stringify({ ...fixture('decision.valid.json'), iteration: 2 })}\n`,
    );
    writeFileSync(
      join(dir, 'evaluation.1.json'),
      `${JSON.stringify(fixture('evaluation.valid.json'))}\n`,
    );

    const artifacts = collectStopArtifacts(dir, 'c');

    assert.equal(artifacts.decision?.iteration, 2);
    assert.equal(artifacts.evaluation, null, 'чужая итерация не выдаётся за свидетельство');
    assert.deepEqual(summarizeStop('c', artifacts).criteria, []);
  });
});

describe('cycle-report: контекст и кэш (ADR 0009, #108)', () => {
  /** Метрики с блоком `context` из фикстуры #107. */
  function withContext() {
    return JSON.parse(readFileSync(join(METRICS_FIXTURES, 'metrics.valid.context.json'), 'utf8'));
  }

  test('summarizeContext: размер последней итерации, рост к первой, доля кэша', () => {
    const context = summarizeContext(withContext());

    assert.equal(context.evidence_bytes, 2560);
    assert.equal(context.evidence_files, 4);
    assert.equal(context.evidence_growth, 1.778, 'последняя измеренная к первой');
    assert.equal(context.input, 2000);
    assert.equal(context.cache_share, 0.3);
    assert.deepEqual(context.stages, [
      { stage: 'plan', input: 1200, cache_share: 0.5 },
      { stage: 'code', input: 800, cache_share: 0 },
    ]);
    assert.deepEqual(context.missing, []);
  });

  test('нет блока context — null и имя блока в недостающих, а не нули', () => {
    const metrics = withContext();
    delete metrics.context;

    const context = summarizeContext(metrics);

    assert.equal(context.evidence_bytes, null);
    assert.equal(context.evidence_growth, null);
    assert.equal(context.input, null);
    assert.equal(context.cache_share, null);
    assert.deepEqual(context.stages, []);
    assert.deepEqual(context.missing, ['нет блока context в metrics.json']);
  });

  test('нет снимков и usage.json — в недостающих и манифесты, и расход', () => {
    const context = summarizeContext(metricsDoc());

    assert.equal(context.evidence_bytes, null);
    assert.equal(context.input, null);
    assert.deepEqual(context.missing, ['manifest.1.json', 'manifest.2.json', 'usage.json']);
  });

  test('одна измеренная итерация роста не даёт: null, а не единица', () => {
    const metrics = metricsDoc({
      context: {
        iterations: [
          {
            iteration: 1,
            evidence_files: null,
            evidence_bytes: null,
            evidence_lines: null,
            evidence_growth: null,
            new_files: null,
          },
          {
            iteration: 2,
            evidence_files: 3,
            evidence_bytes: 900,
            evidence_lines: 30,
            evidence_growth: null,
            new_files: [],
          },
        ],
        missing: ['manifest.1.json'],
        tokens: null,
      },
    });

    const context = summarizeContext(metrics);

    assert.equal(context.evidence_bytes, 900);
    assert.equal(context.evidence_growth, null);
    assert.equal(context.input, null);
  });

  test('нулевой размер первой итерации доли не даёт', () => {
    const metrics = metricsDoc({
      context: {
        iterations: [
          {
            iteration: 1,
            evidence_files: 0,
            evidence_bytes: 0,
            evidence_lines: 0,
            evidence_growth: null,
            new_files: [],
          },
          {
            iteration: 2,
            evidence_files: 2,
            evidence_bytes: 200,
            evidence_lines: 10,
            evidence_growth: null,
            new_files: [],
          },
        ],
        missing: [],
        tokens: null,
      },
    });

    assert.equal(summarizeContext(metrics).evidence_growth, null);
    assert.equal(summarizeContext(metrics).evidence_bytes, 200);
  });

  test('markdown: колонки контекста, insufficient_data и перечень недостающих файлов', () => {
    const report = buildReport([
      summarizeCycle('with-context', withContext()),
      summarizeCycle('without-context', metricsDoc()),
    ]);
    const text = renderMarkdown(report);

    assert.ok(text.includes('| Input-токены | Доля кэша | Размер пакета | Рост evidence |'));
    assert.ok(
      text.includes(
        '| with-context | DONE | 2/2 | 6750 | — | 2000 | 30.0% | 2.5 КБ (4 файла) | ×1.778 |',
      ),
    );
    assert.ok(
      text.includes(
        '| without-context | DONE | 2/2 | 6750 | — | insufficient_data | insufficient_data | insufficient_data | insufficient_data |',
      ),
      'нет замера — insufficient_data, а не нули',
    );
    assert.ok(text.includes('Нечем мерить (insufficient_data):'));
    assert.ok(text.includes('`without-context` — manifest.1.json, manifest.2.json, usage.json'));
    assert.ok(text.includes('## Контекст по стадиям'));
    assert.ok(text.includes('| with-context | plan | 1200 | 50.0% |'));
    assert.ok(text.includes('| with-context | code | 800 | 0.0% |'));
    assert.ok(!text.includes('| without-context | plan |'), 'нет замера — нет строк стадий');
  });

  test('отчёт без контекста вообще: прочерк роста и имя блока в недостающих', () => {
    const metrics = metricsDoc();
    delete metrics.context;
    const text = renderMarkdown(buildReport([summarizeCycle('old-cycle', metrics)]));

    assert.ok(text.includes('insufficient_data'));
    assert.ok(text.includes('`old-cycle` — нет блока context в metrics.json'));
    assert.ok(!text.includes('## Контекст по стадиям'), 'раздел стадий без данных не печатается');
  });

  test('html: те же колонки, таблица стадий и перечень недостающих — без JS и сети', () => {
    const report = buildReport([
      summarizeCycle('with-context', withContext()),
      summarizeCycle('without-context', metricsDoc()),
    ]);
    const html = renderHtml(report);

    for (const title of ['Input-токены', 'Доля кэша', 'Размер пакета', 'Рост evidence']) {
      assert.ok(html.includes(`<th scope="col">${title}</th>`), `колонка ${title}`);
    }
    assert.ok(html.includes('2.5 КБ (4 файла)'));
    assert.ok(html.includes('×1.778'));
    assert.ok(html.includes('30.0%'));
    assert.ok(html.includes('insufficient_data'));
    assert.ok(html.includes('Нечем мерить (insufficient_data):'));
    assert.ok(html.includes('manifest.1.json, manifest.2.json, usage.json'));
    assert.ok(html.includes('<h2>Контекст по стадиям</h2>'));
    assert.ok(!html.includes('<script'), 'без JS');
    assert.ok(!html.includes('http://') && !html.includes('https://'), 'ни одного внешнего URL');
    assert.equal(html, renderHtml(report), 'два вызова дают побайтно равную страницу');
  });

  test('два цикла с разным числом итераций: context в --json и в обоих форматах', (t) => {
    const dir = makeDir(t);
    const oneIteration = metricsDoc({
      iterations: 1,
      context: {
        iterations: [
          {
            iteration: 1,
            evidence_files: 2,
            evidence_bytes: 1024,
            evidence_lines: 20,
            evidence_growth: null,
            new_files: ['evidence/diff.patch'],
          },
        ],
        missing: [],
        tokens: {
          plan: { input: 100, cache_read: 50, cache_write: 0, output: 10, cache_share: 0.5 },
          cycle: { input: 100, cache_read: 50, cache_write: 0, output: 10, cache_share: 0.5 },
        },
      },
    });
    writeCycle(dir, 'a-two-iterations', withContext());
    writeCycle(dir, 'b-one-iteration', oneIteration);

    const json = runCli(['--dir', dir, '--json']);
    assert.equal(json.status, 0, json.stderr);
    const report = JSON.parse(json.stdout.trim());
    assert.deepEqual(
      report.cycles.map((/** @type {any} */ cycle) => cycle.context.evidence_growth),
      [1.778, null],
    );

    const markdown = runCli(['--dir', dir]);
    assert.equal(markdown.status, 0, markdown.stderr);
    assert.ok(markdown.stdout.includes('| b-one-iteration | DONE | 1/2 |'), 'цикл попал в отчёт');
    assert.ok(markdown.stdout.includes('1.0 КБ (2 файла) | — |'), 'одна итерация — роста нет');

    const html = runCli(['--dir', dir, '--html']);
    assert.equal(html.status, 0, html.stderr);
    assert.ok(html.stdout.includes('<h2>Контекст по стадиям</h2>'));
    assert.equal(html.stdout, runCli(['--dir', dir, '--html']).stdout);
  });

  test('--json и --html вместе по-прежнему ошибка использования (код 2)', (t) => {
    const dir = makeDir(t);
    writeCycle(dir, 'a', withContext());

    const result = runCli(['--dir', dir, '--html', '--json']);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--json и --html взаимоисключающие/u);
  });
});
