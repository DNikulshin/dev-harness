import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { ConfigError, DEFAULTS, loadConfig } from './config.mjs';
import { readPriceSnapshot } from './cost.mjs';

/**
 * Временный корень проекта. `.pi` создаётся только при записи конфига.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function makeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'harness-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/**
 * Пишет `.pi/harness.config.json`.
 * @param {string} root
 * @param {unknown} doc объект или строка (для проверки битого JSON)
 * @returns {void}
 */
function writeConfig(root, doc) {
  mkdirSync(join(root, '.pi'), { recursive: true });
  const text = typeof doc === 'string' ? doc : `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(join(root, '.pi', 'harness.config.json'), text);
}

/**
 * Ожидает ошибку конфига с кодом 2 и текстом.
 * @param {() => unknown} fn
 * @param {RegExp} pattern
 * @returns {void}
 */
function throwsConfig(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ConfigError, `ожидался ConfigError, получено ${error}`);
    assert.equal(error.code, 2);
    assert.match(error.message, pattern);
    return true;
  });
}

/** Минимальный гейт нового формата. */
const GATE = {
  id: 'test',
  executable: 'pnpm',
  args: ['test'],
};

describe('loadConfig: дефолты без конфига', () => {
  test('нет файла — работают нейтральные дефолты, гейтов нет', (t) => {
    const root = makeRoot(t);
    const config = loadConfig(root);

    assert.equal(config.gates.length, 0, 'гейты — свойство проекта, не ядра');
    assert.deepEqual(config.limits, DEFAULTS.limits);
    assert.deepEqual(config.paths, DEFAULTS.paths);
    assert.deepEqual(config.evals, DEFAULTS.evals);
    assert.equal(config.provider, 'acme-ai/');
    assert.deepEqual(config.gateTimeouts, {});
  });

  test('DEFAULTS заморожены и не содержат зашитых гейтов', () => {
    assert.ok(Object.isFrozen(DEFAULTS));
    assert.ok(Object.isFrozen(DEFAULTS.limits));
    assert.deepEqual(DEFAULTS.gates, []);
  });
});

describe('loadConfig: переопределения проекта', () => {
  test('лимиты, пути, провайдер и гейты берутся из конфига', (t) => {
    const root = makeRoot(t);
    writeConfig(root, {
      provider: 'example-ai/',
      limits: { maxDiffLines: 10, maxCycleCostRub: 5.5 },
      paths: { artifactsDir: 'artifacts', prTemplate: '.github/PULL_REQUEST_TEMPLATE.md' },
      evals: { prices: 'data/prices.json' },
      gates: [
        GATE,
        {
          id: 'build',
          executable: 'pnpm',
          args: ['run', 'build'],
          required: false,
          dependsOn: ['test'],
          pathPrefixes: ['src/'],
        },
      ],
      gateTimeouts: { test: 1000 },
    });

    const config = loadConfig(root);

    assert.equal(config.limits.maxDiffLines, 10);
    assert.equal(config.limits.maxCycleCostRub, 5.5);
    assert.equal(config.limits.maxDiffBytes, DEFAULTS.limits.maxDiffBytes, 'остальные — дефолт');
    assert.equal(config.paths.artifactsDir, 'artifacts');
    assert.equal(config.paths.prTemplate, '.github/PULL_REQUEST_TEMPLATE.md');
    assert.equal(config.paths.agentsDir, DEFAULTS.paths.agentsDir);
    assert.equal(config.evals.prices, 'data/prices.json');
    assert.equal(config.provider, 'example-ai/');
    assert.deepEqual(config.gateTimeouts, { test: 1000 });

    assert.deepEqual(
      config.gates.map((gate) => gate.id),
      ['test', 'build'],
    );
    assert.deepEqual(config.gates[1].dependsOn, ['test']);
    assert.equal(config.gates[1].required, false);
    assert.equal(config.gates[0].cmd, 'pnpm test');
    assert.ok(Object.isFrozen(config.gates[0]), 'гейты заморожены');
  });

  test('старый cmd разбирается по пробелам и печатает предупреждение', (t) => {
    const root = makeRoot(t);
    writeConfig(root, { gates: [{ id: 'legacy', cmd: 'pnpm --filter @acme/core build' }] });

    const config = loadConfig(root);

    assert.deepEqual(config.gates[0].args, ['--filter', '@acme/core', 'build']);
    assert.equal(config.gates[0].cmd, 'pnpm --filter @acme/core build');
  });

  test('builtin-гейт не требует executable', (t) => {
    const root = makeRoot(t);
    writeConfig(root, { gates: [{ id: 'secrets_scan', builtin: 'secrets_scan' }] });

    const config = loadConfig(root);

    assert.equal(config.gates[0].executable, null);
    assert.equal(config.gates[0].cmd, null);
  });
});

describe('loadConfig: невалидные значения — ошибка с кодом 2', () => {
  const cases = [
    {
      name: 'битый JSON',
      doc: '{ "gates": [',
      pattern: /битый JSON/u,
    },
    {
      name: 'неизвестная секция',
      doc: { unknown: true },
      pattern: /неизвестная секция unknown/u,
    },
    {
      name: 'неизвестное поле лимитов',
      doc: { limits: { maxDiffLine: 10 } },
      pattern: /неизвестное поле limits\.maxDiffLine/u,
    },
    {
      name: 'лимит не число',
      doc: { limits: { maxDiffLines: '10' } },
      pattern: /limits\.maxDiffLines — ожидается число/u,
    },
    {
      name: 'отрицательный лимит',
      doc: { limits: { maxDiffBytes: -1 } },
      pattern: /положительное число/u,
    },
    {
      name: 'дубль id гейта',
      doc: { gates: [GATE, GATE] },
      pattern: /дубль "test"/u,
    },
    {
      name: 'пустой id',
      doc: { gates: [{ ...GATE, id: '' }] },
      pattern: /пустой идентификатор/u,
    },
    {
      name: 'нет executable',
      doc: { gates: [{ id: 'lint', args: ['lint'] }] },
      pattern: /executable — ожидается непустая строка/u,
    },
    {
      name: 'gates не массив',
      doc: { gates: {} },
      pattern: /gates — ожидается массив/u,
    },
    {
      name: 'неизвестная зависимость',
      doc: { gates: [{ ...GATE, dependsOn: ['missing'] }] },
      pattern: /неизвестный гейт missing/u,
    },
    {
      name: 'тайм-аут неизвестного гейта',
      doc: { gateTimeouts: { missing: 1000 } },
      pattern: /gateTimeouts\.missing/u,
    },
    {
      name: 'провайдер без завершающего слэша',
      doc: { provider: 'acme-ai' },
      pattern: /provider/u,
    },
  ];

  for (const { name, doc, pattern } of cases) {
    test(name, (t) => {
      const root = makeRoot(t);
      writeConfig(root, doc);
      throwsConfig(() => loadConfig(root), pattern);
    });
  }

  test('ошибка не печатает содержимое файла конфига', (t) => {
    const root = makeRoot(t);
    writeConfig(root, { limits: { maxDiffLines: 'СЕКРЕТ_ИЗ_ENV' } });

    try {
      loadConfig(root);
      assert.fail('ожидалась ошибка');
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      assert.ok(!error.message.includes('СЕКРЕТ_ИЗ_ENV'));
    }
  });
});

describe('loadConfig: приоритет явного значения', () => {
  test('явный путь в аргументе важнее пути из конфига', (t) => {
    const root = makeRoot(t);
    writeConfig(root, { evals: { prices: 'custom/prices.json' } });

    const priceDoc = (model) => ({
      _meta: { currency: 'RUB' },
      models: { [model]: { input: 1, output: 2, cache_read: 0, cache_write: 0, context: 1000 } },
    });
    for (const [dir, model] of [
      ['custom', 'acme/from-config'],
      ['override', 'acme/from-argument'],
    ]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'prices.json'), JSON.stringify(priceDoc(model)));
    }
    mkdirSync(join(root, 'evals'), { recursive: true });
    writeFileSync(
      join(root, 'evals', 'prices.json'),
      JSON.stringify(priceDoc('acme/from-default')),
    );

    const config = loadConfig(root);
    assert.equal(config.evals.prices, 'custom/prices.json');
    assert.deepEqual(
      Object.keys(readPriceSnapshot(root, config.evals.prices) ?? {}),
      ['acme/from-config'],
      'конфиг задаёт путь',
    );
    assert.deepEqual(
      Object.keys(readPriceSnapshot(root, 'override/prices.json') ?? {}),
      ['acme/from-argument'],
      'явный аргумент перекрывает путь конфига',
    );
  });
});
