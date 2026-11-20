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

/**
 * Гейт по индексу: таблица в тестах всегда непустая, `undefined` означал бы ошибку теста.
 * @param {readonly import('./config.mjs').LoadedGate[]} gates
 * @param {number} index
 * @returns {import('./config.mjs').LoadedGate}
 */
function gateAt(gates, index) {
  const gate = gates[index];
  assert.ok(gate, `гейт #${index} есть в конфиге`);
  return gate;
}

/**
 * Гейт по id: `undefined` означал бы, что конфиг потерял объявленный гейт.
 * @param {readonly import('./config.mjs').LoadedGate[]} gates
 * @param {string} id
 * @returns {import('./config.mjs').LoadedGate}
 */
function gateById(gates, id) {
  const gate = gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `гейт ${id} есть в конфиге`);
  return gate;
}

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
    assert.deepEqual(gateAt(config.gates, 1).dependsOn, ['test']);
    assert.equal(gateAt(config.gates, 1).required, false);
    assert.equal(gateAt(config.gates, 0).cmd, 'pnpm test');
    assert.ok(Object.isFrozen(gateAt(config.gates, 0)), 'гейты заморожены');
  });

  test('старый cmd разбирается по пробелам и печатает предупреждение', (t) => {
    const root = makeRoot(t);
    writeConfig(root, { gates: [{ id: 'legacy', cmd: 'pnpm --filter @acme/core build' }] });

    const config = loadConfig(root);

    assert.deepEqual(gateAt(config.gates, 0).args, ['--filter', '@acme/core', 'build']);
    assert.equal(gateAt(config.gates, 0).cmd, 'pnpm --filter @acme/core build');
  });

  test('builtin-гейт не требует executable', (t) => {
    const root = makeRoot(t);
    writeConfig(root, { gates: [{ id: 'secrets_scan', builtin: 'secrets_scan' }] });

    const config = loadConfig(root);

    assert.equal(gateAt(config.gates, 0).executable, null);
    assert.equal(gateAt(config.gates, 0).cmd, null);
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

    /** @param {string} model @returns {Record<string, unknown>} */
    const priceDoc = (model) => ({
      _meta: { currency: 'RUB' },
      models: { [model]: { input: 1, output: 2, cache_read: 0, cache_write: 0, context: 1000 } },
    });
    for (const [dir, model] of /** @type {[string, string][]} */ ([
      ['custom', 'acme/from-config'],
      ['override', 'acme/from-argument'],
    ])) {
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

describe('config: qaWeb и dbGate', () => {
  /**
   * Конфиг проекта с переданным JSON.
   * @param {import('node:test').TestContext} t
   * @param {unknown} doc
   * @returns {string}
   */
  function project(t, doc) {
    const root = mkdtempSync(join(tmpdir(), 'harness-config-qaweb-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.pi'), { recursive: true });
    writeFileSync(join(root, '.pi', 'harness.config.json'), JSON.stringify(doc));
    return root;
  }

  test('без секций qaWeb и dbGate — пустые префиксы и гейт не БД', (t) => {
    const root = project(t, { gates: [{ id: 'test', executable: 'node', args: ['--test'] }] });
    const config = loadConfig(root);

    assert.deepEqual(config.qaWeb.pathPrefixes, []);
    assert.equal(gateAt(config.gates, 0).dbGate, false);
  });

  test('конфиг задаёт префиксы web и помечает БД-гейт', (t) => {
    const root = project(t, {
      qaWeb: { pathPrefixes: ['apps/client/', 'apps/admin'] },
      gates: [
        { id: 'test', executable: 'node', args: ['--test'] },
        { id: 'test_int', executable: 'pnpm', args: ['test:int'], dbGate: true },
      ],
    });
    const config = loadConfig(root);

    assert.deepEqual(config.qaWeb.pathPrefixes, ['apps/client/', 'apps/admin']);
    assert.equal(gateById(config.gates, 'test_int').dbGate, true);
    assert.equal(gateById(config.gates, 'test').dbGate, false);
  });

  for (const [name, doc] of [
    ['qaWeb не объект', { qaWeb: [] }],
    ['qaWeb.pathPrefixes не массив', { qaWeb: { pathPrefixes: 'apps/client' } }],
    ['qaWeb.pathPrefixes содержит пустую строку', { qaWeb: { pathPrefixes: [''] } }],
    ['qaWeb с неизвестным полем', { qaWeb: { pathPrefixes: [], extra: 1 } }],
    ['dbGate не boolean', { gates: [{ id: 'test', executable: 'node', dbGate: 'yes' }] }],
    [
      'dbGate: null не проваливается в дефолт',
      { gates: [{ id: 'test', executable: 'node', dbGate: null }] },
    ],
    [
      'required: null не проваливается в дефолт',
      { gates: [{ id: 'test', executable: 'node', required: null }] },
    ],
  ]) {
    test(`${name} — ошибка конфига с кодом 2`, (t) => {
      const root = project(t, doc);
      assert.throws(
        () => loadConfig(root),
        (error) => error instanceof ConfigError && error.code === 2,
      );
    });
  }
});

describe('config: integrity (#27)', () => {
  /**
   * Конфиг проекта с переданным JSON.
   * @param {import('node:test').TestContext} t
   * @param {unknown} doc
   * @returns {string}
   */
  function project(t, doc) {
    const root = mkdtempSync(join(tmpdir(), 'harness-config-integrity-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.pi'), { recursive: true });
    writeFileSync(join(root, '.pi', 'harness.config.json'), JSON.stringify(doc));
    return root;
  }

  test('секции нет — правил нет, это валидное состояние', (t) => {
    const contract = loadConfig(project(t, {}));
    assert.deepEqual(contract.integrity.testPaths, []);
    assert.deepEqual(contract.integrity.protectedPaths, []);

    const partial = loadConfig(project(t, { integrity: { testPaths: ['tests'] } }));
    assert.deepEqual(partial.integrity.testPaths, ['tests']);
    assert.deepEqual(partial.integrity.protectedPaths, [], 'недостающая половина — пустая');
  });

  test('пустая секция — тоже валидное состояние', (t) => {
    const config = loadConfig(project(t, { integrity: {} }));
    assert.deepEqual(config.integrity, { testPaths: [], protectedPaths: [] });
  });

  test('правила читаются как есть, завершающий слэш срезается', (t) => {
    const config = loadConfig(
      project(t, {
        integrity: {
          testPaths: ['**/*.test.mjs', 'tests/'],
          protectedPaths: ['.pi/harness.config.json', '.pi/agents'],
        },
      }),
    );

    assert.deepEqual(config.integrity.testPaths, ['**/*.test.mjs', 'tests']);
    assert.deepEqual(config.integrity.protectedPaths, ['.pi/harness.config.json', '.pi/agents']);
    assert.ok(Object.isFrozen(config.integrity), 'правила заморожены, как и остальной конфиг');
  });

  for (const [name, doc] of [
    ['integrity не объект', { integrity: [] }],
    ['integrity с неизвестным полем', { integrity: { testPaths: [], extra: [] } }],
    ['testPaths не массив', { integrity: { testPaths: 'tests' } }],
    ['protectedPaths содержит пустую строку', { integrity: { protectedPaths: [''] } }],
    ['правило с «..»', { integrity: { testPaths: ['../outside/**'] } }],
    ['правило абсолютное', { integrity: { protectedPaths: ['/etc/passwd'] } }],
    ['правило с пустым сегментом', { integrity: { testPaths: ['tests//unit'] } }],
    ['правило с «.»', { integrity: { testPaths: ['./tests'] } }],
    ['правило с обратным слэшем', { integrity: { testPaths: ['tests\\unit'] } }],
    ['правило из одного слэша', { integrity: { testPaths: ['/'] } }],
  ]) {
    test(`${name} — ошибка конфига с кодом 2`, (t) => {
      const root = project(t, doc);
      assert.throws(
        () => loadConfig(root),
        (error) => error instanceof ConfigError && error.code === 2,
      );
    });
  }
});
