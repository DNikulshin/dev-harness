import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const SCRIPT = resolve(import.meta.dirname, 'evals-score.mjs');

/** Сид-дефект: ожидается BLOCKER в `apps/service/src/x.ts:11`. */
const DEFECT_SEED = {
  id: 'E5',
  title: 'Телефон в логе',
  why: 'ПДн в логах',
  expect: { kind: 'defect', severity: 'BLOCKER', file: 'apps/service/src/x.ts', line: 11 },
  issue: { title: 'issue', body: 'тело' },
  criteria: ['критерий'],
  base: { 'apps/service/src/x.ts': 'до\n' },
  after: { 'apps/service/src/x.ts': 'после\n' },
};

/** Чистый сид: блокеров быть не должно. */
const CLEAN_SEED = {
  id: 'E10',
  title: 'Чистая правка',
  why: 'контроль',
  expect: { kind: 'clean' },
  issue: { title: 'issue', body: 'тело' },
  criteria: ['критерий'],
  base: { 'apps/service/src/y.ts': 'до\n' },
  after: { 'apps/service/src/y.ts': 'после\n' },
};

/**
 * Ответ ревьюера. `hit = false` даёт находку в другом файле (промах).
 * @param {boolean} hit
 * @returns {string}
 */
function reviewAnswer(hit) {
  const doc = {
    verdict: 'needs-changes',
    findings: [
      {
        id: 'R1',
        severity: 'BLOCKER',
        file: hit ? 'apps/service/src/x.ts' : 'apps/service/src/other.ts',
        line: 11,
        summary: 'телефон в логе без маскирования',
        repro: 'открыть файл',
        in_scope: true,
        preexisting: false,
      },
    ],
  };
  return `Ревью.\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\`\n`;
}

/** Ответ оценщика: дефект со ссылкой на файл и строку. */
function evaluationAnswer() {
  const doc = {
    verdict: 'REWORK',
    criteria: [{ id: 'C1', status: 'unmet', evidence: [], note: 'ПДн' }],
    scores: {
      coverage: 1,
      correctness: 0,
      tests: null,
      data: null,
      pii_security: 0,
      architecture: null,
      scope: 3,
      docs: null,
      evidence: 2,
    },
    defects: [
      {
        id: 'D1',
        severity: 'BLOCKER',
        claim: 'телефон в логе',
        evidence: ['apps/service/src/x.ts:11'],
        repro: 'вызвать обработчик',
      },
    ],
    unverified: [],
  };
  return `Оценка.\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\`\n`;
}

/**
 * Дерево-фикстура с сидами и ценами.
 * @returns {string}
 */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'evals-score-'));
  mkdirSync(join(root, 'evals', 'orchestrator', 'seeds'), { recursive: true });
  writeFileSync(
    join(root, 'evals', 'orchestrator', 'seeds', 'E5.json'),
    JSON.stringify(DEFECT_SEED),
  );
  writeFileSync(
    join(root, 'evals', 'orchestrator', 'seeds', 'E10.json'),
    JSON.stringify(CLEAN_SEED),
  );
  writeFileSync(
    join(root, 'evals', 'prices.json'),
    JSON.stringify({
      _meta: { currency: 'RUB' },
      models: {
        'openai/gpt-6-luna-pro': {
          input: 1,
          output: 2,
          cache_read: 0.5,
          cache_write: 0,
          context: 1,
        },
        'z-ai/glm-5.3': { input: 1, output: 2, cache_read: 0.5, cache_write: 0, context: 1 },
      },
    }),
  );
  return root;
}

/**
 * Каталог прогона с meta и ответами этапов.
 * @param {string} root
 * @param {{ name: string, seed: string, review: string, evaluate?: string, usage?: unknown, repeat?: number }} params
 * @returns {string}
 */
function writeRun(root, { name, seed, review, evaluate, usage, repeat }) {
  const dir = join(root, '.pi', 'artifacts', 'evals', name);
  mkdirSync(dir, { recursive: true });
  /** @type {Record<string, unknown>} */
  const meta = {
    seed,
    config: 'current',
    models: { review: 'openai/gpt-6-luna-pro', evaluate: 'z-ai/glm-5.3' },
    stages: ['review', 'evaluate'],
    created_at: '2026-01-02T00:00:00Z',
  };
  if (repeat !== undefined) meta.repeat = repeat;
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  writeFileSync(join(dir, 'review.md'), review);
  if (evaluate !== undefined) writeFileSync(join(dir, 'evaluate.md'), evaluate);
  if (usage !== undefined) writeFileSync(join(dir, 'usage.json'), JSON.stringify(usage));
  return dir;
}

/**
 * Запуск CLI: код выхода и потоки вместо исключения.
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: /** @type {{ status?: number }} */ (error).status ?? -1,
      stdout: String(/** @type {{ stdout?: unknown }} */ (error).stdout ?? ''),
      stderr: String(/** @type {{ stderr?: unknown }} */ (error).stderr ?? ''),
    };
  }
}

describe('evals-score', () => {
  test('пишет report.json и report.md, пороги не нарушены — код 0', () => {
    const root = fixtureRoot();
    const runsDir = join(root, '.pi', 'artifacts', 'evals');
    writeRun(root, {
      name: '2026-01-02-E5-current',
      seed: 'E5',
      review: reviewAnswer(true),
      evaluate: evaluationAnswer(),
      usage: { review: { input: 1_000_000, cache_read: 0, output: 0 } },
    });
    writeRun(root, {
      name: '2026-01-02-E10-current',
      seed: 'E10',
      review: '```json\n{"verdict":"merge-ready","findings":[]}\n```\n',
    });

    const result = run(['--root', root]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /полнота 1\.00/u);

    const report = JSON.parse(readFileSync(join(runsDir, 'report.json'), 'utf8'));
    assert.equal(report.verdict, 'ok');
    assert.equal(report.configs.current.summary.hits, 1);
    assert.equal(report.configs.current.summary.misses, 0);
    assert.equal(report.configs.current.by_seed.E5.union, 'hit');
    assert.equal(report.configs.current.by_seed.E10.union, 'clean');
    // Стоимость по фактическому usage и ценам снапшота: 1M входа × 1 ₽.
    assert.equal(report.configs.current.summary.avg_cost_rub, 1);

    const markdown = readFileSync(join(runsDir, 'report.md'), 'utf8');
    assert.match(markdown, /# Прогоны сидов/u);
    assert.match(markdown, /\| сид \| review \| evaluate \| итог \|/u);
    assert.match(markdown, /Пороги не нарушены/u);
  });

  test('промах по сиду даёт полноту 0 и код 1', () => {
    const root = fixtureRoot();
    const runsDir = join(root, '.pi', 'artifacts', 'evals');
    writeRun(root, { name: '2026-01-02-E5-current', seed: 'E5', review: reviewAnswer(false) });
    writeRun(root, {
      name: '2026-01-02-E10-current',
      seed: 'E10',
      review: '```json\n{"verdict":"merge-ready","findings":[]}\n```\n',
    });

    const result = run(['--root', root]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /полнота 0\.00/u);

    const report = JSON.parse(readFileSync(join(runsDir, 'report.json'), 'utf8'));
    assert.equal(report.verdict, 'below_threshold');
    assert.equal(report.configs.current.summary.misses, 1);
  });

  test('неразобранный ответ попадает в отчёт как invalid, а не как промах', () => {
    const root = fixtureRoot();
    const runsDir = join(root, '.pi', 'artifacts', 'evals');
    writeRun(root, { name: '2026-01-02-E5-current', seed: 'E5', review: 'ответ без блока' });

    const result = run(['--root', root]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(readFileSync(join(runsDir, 'report.json'), 'utf8'));
    assert.equal(report.configs.current.counts.invalid, 1);
    assert.equal(report.configs.current.summary.completeness, null);
    assert.equal(report.verdict, 'insufficient_data');
    assert.match(readFileSync(join(runsDir, 'report.md'), 'utf8'), /Не разобранные ответы/u);
    assert.match(
      readFileSync(join(runsDir, 'report.md'), 'utf8'),
      /Данных для проверки порогов нет/u,
    );
    assert.match(result.stdout, /недостаточно данных/u);
  });

  test('без прогонов — ошибка данных, код 2', () => {
    const root = fixtureRoot();
    const result = run(['--root', root]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /прогонов нет/u);
  });

  test('мусор в аргументах — код 2', () => {
    const root = fixtureRoot();
    assert.match(run(['--root', root, '--completeness', '2']).stderr, /от 0 до 1/u);
    assert.match(run(['--root', root, '--nope']).stderr, /неизвестный аргумент/u);
  });

  test('три повтора того же сида не затирают друг друга: агрегат и расхождение в отчёте', () => {
    const root = fixtureRoot();
    const runsDir = join(root, '.pi', 'artifacts', 'evals');
    writeRun(root, {
      name: '2026-01-02-E5-current-r1',
      seed: 'E5',
      review: reviewAnswer(true),
      repeat: 3,
    });
    writeRun(root, {
      name: '2026-01-02-E5-current-r2',
      seed: 'E5',
      review: reviewAnswer(true),
      repeat: 3,
    });
    writeRun(root, {
      name: '2026-01-02-E5-current-r3',
      seed: 'E5',
      review: reviewAnswer(false),
      repeat: 3,
    });

    const result = run(['--root', root]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /повторы E5\/review: hit 2\/3, miss 1\/3 → hit/u);
    assert.match(result.stdout, /повторов 3/u);

    const report = JSON.parse(readFileSync(join(runsDir, 'report.json'), 'utf8'));
    const cell = report.configs.current.by_seed.E5.runs.review;
    assert.equal(cell.count, 3);
    assert.equal(cell.planned, 3);
    assert.equal(cell.aggregate, 'hit');
    assert.equal(cell.agreement, 0.67);
    assert.equal(report.configs.current.by_seed.E5.union, 'hit');
    assert.equal(report.configs.current.summary.repeats, 3);

    const markdown = readFileSync(join(runsDir, 'report.md'), 'utf8');
    assert.match(markdown, /### Повторы/u);
    assert.match(markdown, /\| E5 \| review \| 3 \| 3 \| hit 2\/3, miss 1\/3 \| hit \| 0\.67 \|/u);
  });

  test('каталог без repeat читается как один повтор', () => {
    const root = fixtureRoot();
    writeRun(root, { name: '2026-01-02-E5-current', seed: 'E5', review: reviewAnswer(true) });

    const result = run(['--root', root]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(
      readFileSync(join(root, '.pi', 'artifacts', 'evals', 'report.json'), 'utf8'),
    );
    assert.equal(report.configs.current.by_seed.E5.runs.review.planned, 1);
    assert.equal(report.configs.current.summary.repeats, 1);
    assert.deepEqual(report.warnings, []);
  });

  test('план повторов больше факта — предупреждение в отчёте, код не меняется', () => {
    const root = fixtureRoot();
    const runsDir = join(root, '.pi', 'artifacts', 'evals');
    writeRun(root, {
      name: '2026-01-02-E5-current',
      seed: 'E5',
      review: reviewAnswer(true),
      repeat: 3,
    });

    const result = run(['--root', root]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /не хватает повторов: current: E5\/review — 1 из 3/u);
    assert.match(readFileSync(join(runsDir, 'report.md'), 'utf8'), /Повторов меньше плана/u);
  });

  test('repeat в meta.json не целое ≥ 1 — ошибка данных, код 2', () => {
    const root = fixtureRoot();
    writeRun(root, {
      name: '2026-01-02-E5-current',
      seed: 'E5',
      review: reviewAnswer(true),
    });
    const metaFile = join(root, '.pi', 'artifacts', 'evals', '2026-01-02-E5-current', 'meta.json');
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    meta.repeat = 0;
    writeFileSync(metaFile, JSON.stringify(meta));

    const result = run(['--root', root]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /repeat должен быть целым ≥ 1/u);
  });

  test('каталог прогонов вне .pi/artifacts читается только по --runs', () => {
    const root = fixtureRoot();
    const external = mkdtempSync(join(tmpdir(), 'evals-runs-'));
    const dir = join(external, 'r1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ seed: 'E5', config: 'x', models: {}, stages: [], created_at: 'z' }),
    );
    writeFileSync(join(dir, 'review.md'), reviewAnswer(true));

    const result = run(['--root', root, '--runs', external]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(external, 'report.json')));
  });
});
