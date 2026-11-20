import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULTS } from './config.mjs';
import {
  LIMIT_FLAGS,
  LIMIT_KEYS,
  LIMIT_RULES,
  LimitsError,
  checkLimitValue,
  describedLimits,
  envNameFor,
  resolveLimits,
  sourceLabel,
} from './limits.mjs';

/**
 * Конфиг проекта: значения + явно заданные ключи (форма `loadConfig`).
 * @param {Record<string, number>} limits
 * @returns {{ config: Record<string, number>, configured: string[] }}
 */
function projectConfig(limits) {
  return { config: { ...DEFAULTS.limits, ...limits }, configured: Object.keys(limits) };
}

describe('LIMIT_RULES / envNameFor', () => {
  test('ключи описаны и диапазоны упорядочены', () => {
    for (const key of LIMIT_KEYS) {
      const rule = LIMIT_RULES[key];
      assert.ok(rule, `${key}: правило есть`);
      assert.ok(rule.min > 0, `${key}: минимум положительный`);
      assert.ok(rule.max > rule.min, `${key}: максимум больше минимума`);
    }
  });

  test('переменная окружения строится из ключа', () => {
    assert.equal(envNameFor('maxDiffLines'), 'HARNESS_LIMIT_MAX_DIFF_LINES');
    assert.equal(envNameFor('maxCycleCostRub'), 'HARNESS_LIMIT_MAX_CYCLE_COST_RUB');
  });

  test('флаги есть только у двух ключей', () => {
    assert.deepEqual(Object.keys(LIMIT_FLAGS).sort(), ['defaultMaxIterations', 'maxCycleCostRub']);
  });
});

describe('checkLimitValue', () => {
  test('принимает число и числовую строку', () => {
    assert.equal(checkLimitValue('maxDiffLines', 100, 'тест'), 100);
    assert.equal(checkLimitValue('maxDiffLines', ' 120 ', 'тест'), 120);
  });

  test('дробное значение допустимо только для бюджета', () => {
    assert.equal(checkLimitValue('maxCycleCostRub', 12.5, 'тест'), 12.5);
    assert.throws(() => checkLimitValue('maxDiffLines', 1.5, 'тест'), LimitsError);
  });

  test('вне диапазона и не число — ошибка с источником в тексте', () => {
    assert.throws(() => checkLimitValue('maxDiffLines', 10, '--max-diff-lines'), /диапазона/u);
    assert.throws(() => checkLimitValue('maxDiffLines', 'abc', 'ENV_NAME'), /ENV_NAME/u);
    assert.throws(() => checkLimitValue('nope', 1, 'тест'), /неизвестный лимит/u);
  });
});

describe('resolveLimits: приоритет CLI → env → конфиг → дефолт', () => {
  test('без источников — дефолты ядра, и источник у каждого default', () => {
    const resolved = resolveLimits({ defaults: DEFAULTS.limits, env: {} });

    assert.deepEqual(resolved.values, DEFAULTS.limits);
    for (const key of LIMIT_KEYS) assert.equal(resolved.sources[key], 'default');
  });

  test('значение из файла проекта помечается config', () => {
    const resolved = resolveLimits({
      ...projectConfig({ maxDiffLines: 5000 }),
      defaults: DEFAULTS.limits,
      env: {},
    });

    assert.equal(resolved.values.maxDiffLines, 5000);
    assert.equal(resolved.sources.maxDiffLines, 'config');
    assert.equal(resolved.sources.maxDiffBytes, 'default', 'не заданные ключи остаются дефолтом');
  });

  test('переменная окружения важнее конфига, флаг важнее окружения', () => {
    const env = { HARNESS_LIMIT_MAX_DIFF_LINES: '7000' };

    const fromEnv = resolveLimits({
      ...projectConfig({ maxDiffLines: 5000 }),
      defaults: DEFAULTS.limits,
      env,
    });
    assert.equal(fromEnv.values.maxDiffLines, 7000);
    assert.equal(fromEnv.sources.maxDiffLines, 'env');

    const fromCli = resolveLimits({
      ...projectConfig({ maxDiffLines: 5000 }),
      defaults: DEFAULTS.limits,
      env,
      cli: { maxDiffLines: 9000 },
    });
    assert.equal(fromCli.values.maxDiffLines, 9000);
    assert.equal(fromCli.sources.maxDiffLines, 'cli');
  });

  test('ключи, пришедшие из дефолтов конфига, не выдают себя за проектные', () => {
    const resolved = resolveLimits({
      ...projectConfig({ defaultMaxIterations: 3 }),
      defaults: DEFAULTS.limits,
      env: {},
    });

    assert.equal(resolved.sources.defaultMaxIterations, 'config');
    assert.equal(resolved.sources.logMaxBytes, 'default');
  });

  test('невалидное значение из окружения — ошибка, а не откат к дефолту', () => {
    assert.throws(
      () =>
        resolveLimits({
          defaults: DEFAULTS.limits,
          env: { HARNESS_LIMIT_LOG_MAX_BYTES: 'мало' },
        }),
      /HARNESS_LIMIT_LOG_MAX_BYTES/u,
    );
  });

  test('нет значения ни в одном источнике — ошибка', () => {
    assert.throws(() => resolveLimits({ defaults: {}, env: {} }), LimitsError);
  });
});

describe('describedLimits / sourceLabel', () => {
  test('описывает каждый ключ значением и источником', () => {
    const described = describedLimits(
      resolveLimits({ defaults: DEFAULTS.limits, env: {}, cli: { maxCycleCostRub: 15 } }),
    );

    assert.deepEqual(described.maxCycleCostRub, { value: 15, source: 'cli' });
    assert.deepEqual(Object.keys(described).sort(), [...LIMIT_KEYS].sort());
  });

  test('источники читаются по-русски', () => {
    assert.match(sourceLabel('config'), /конфиг/u);
    assert.match(sourceLabel('cli'), /CLI/u);
  });

  test('ошибка лимита из конфига называет фактический путь, а не литерал', () => {
    assert.throws(
      () =>
        resolveLimits({
          config: { maxDiffLines: 2 },
          configured: ['maxDiffLines'],
          env: {},
          defaults: DEFAULTS.limits,
          configLabel: 'harness/harness.config.json',
        }),
      /harness\/harness\.config\.json/u,
    );
    assert.match(sourceLabel('config'), /конфиг/u, 'без пути — нейтральная подпись');
  });
});
