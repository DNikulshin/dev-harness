/**
 * Лимиты цикла: источники, приоритет и проверка значений (issue #235).
 *
 * Пороги цикл берёт из проекта, а не из кода ядра: значения приходят из
 * `<root>/.pi/harness.config.json` (раздел `limits`, разбирается `config.mjs`), а поверх них
 * работают переопределения — CLI-флаг и переменная окружения. Приоритет по каждому ключу:
 * **CLI → env → конфиг → дефолт ядра**.
 *
 * Невалидное значение — ошибка (`LimitsError`, у скриптов код 2), а не молчаливый откат к
 * дефолту: иначе поднятый лимит «не применяется» без следа, и цикл эскалируется по прежнему
 * порогу. Модуль не читает файлов: конфиг уже загружен вызывающим (`loadConfig`), поэтому
 * расчёт остаётся чистым и проверяемым без временных каталогов.
 *
 * Наблюдаемость: `resolveLimits` возвращает не только значения, но и источник каждого
 * (`cli`/`env`/`config`/`default`); он попадает в `decision.<n>.json` и `metrics.json`
 * (`applied_limits`), чтобы по артефактам было видно, с каким лимитом считали.
 *
 * Shebang не нужен: модуль подключается из CLI-скриптов `cycle-*.mjs`.
 */

/**
 * Источник значения лимита: от него зависит и текст причины, и вид артефакта.
 * @typedef {'cli'|'env'|'config'|'default'} LimitSource
 */

/** Ошибка конфигурации лимитов: скрипты цикла превращают её в код 2. */
export class LimitsError extends Error {}

/**
 * Ключи лимитов и правила проверки. `integer` — целое (дроби не допускаются, кроме бюджета),
 * `min`/`max` — допустимый диапазон. Бюджет — рубли, допускает дробное значение.
 * @type {Readonly<Record<string, { integer: boolean, min: number, max: number }>>}
 */
export const LIMIT_RULES = Object.freeze({
  maxCycleCostRub: { integer: false, min: 1, max: 10_000 },
  defaultMaxIterations: { integer: true, min: 1, max: 10 },
  maxDiffLines: { integer: true, min: 50, max: 100_000 },
  maxDiffBytes: { integer: true, min: 1_024, max: 10 * 1024 * 1024 },
  logMaxBytes: { integer: true, min: 1_024, max: 100 * 1024 * 1024 },
  evidenceTailLines: { integer: true, min: 1, max: 10_000 },
});

/** Ключи лимитов в нормативном порядке. */
export const LIMIT_KEYS = Object.freeze(Object.keys(LIMIT_RULES));

/**
 * CLI-флаги, переопределяющие лимиты. На остальные ключи флагов нет: интерфейс скриптов не
 * должен разрастаться, для них есть переменные окружения.
 * @type {Readonly<Record<string, string>>}
 */
export const LIMIT_FLAGS = Object.freeze({
  maxCycleCostRub: '--max-cost-rub',
  defaultMaxIterations: '--max-iterations',
});

/** Человекочитаемые имена источников для причин и отчётов. */
const SOURCE_LABELS = Object.freeze({
  cli: 'CLI-флаг',
  env: 'переменная окружения',
  config: 'конфиг проекта',
  default: 'дефолт ядра',
});

/**
 * Имя переменной окружения для ключа: `HARNESS_LIMIT_<SNAKE_UPPER>`.
 * @param {string} key
 * @returns {string}
 */
export function envNameFor(key) {
  return `HARNESS_LIMIT_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
}

/**
 * Источник лимита по-русски: для текста причины, а не для машины.
 * @param {'cli'|'env'|'config'|'default'} source
 * @returns {string}
 */
export function sourceLabel(source) {
  return SOURCE_LABELS[source] ?? source;
}

/**
 * Проверяет одно значение лимита.
 * @param {string} key
 * @param {unknown} value
 * @param {string} source человекочитаемый источник (для текста ошибки)
 * @returns {number}
 */
export function checkLimitValue(key, value, source) {
  const rule = LIMIT_RULES[key];
  if (rule === undefined) throw new LimitsError(`limits: неизвестный лимит «${key}»`);

  const numeric = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    throw new LimitsError(
      `limits.${key}: ожидается число, получено ${JSON.stringify(value)} (${source})`,
    );
  }
  if (rule.integer && !Number.isInteger(numeric)) {
    throw new LimitsError(`limits.${key}: ожидается целое число, получено ${numeric} (${source})`);
  }
  if (numeric < rule.min || numeric > rule.max) {
    throw new LimitsError(
      `limits.${key}: ${numeric} вне диапазона ${rule.min}…${rule.max} (${source})`,
    );
  }
  return numeric;
}

/**
 * Итоговые лимиты с приоритетом CLI → env → конфиг → дефолт.
 * @param {{
 *   config?: Record<string, number>|null,
 *   configured?: readonly string[]|null,
 *   cli?: Record<string, unknown>,
 *   env?: Record<string, string|undefined>,
 *   defaults?: Readonly<Record<string, number>>,
 *   configLabel?: string,
 * }} [options]
 *   `config` — раздел `limits` из `loadConfig` (уже проверен схемой), `configured` — ключи,
 *   заданные в файле проекта (`config.limitsExplicit`): только они имеют источник `config`,
 *   остальные значения из `config` пришли из дефолтов ядра. `cli` — значения флагов,
 *   `env` — окружение, `defaults` — дефолты ядра (`DEFAULTS.limits`), `configLabel` —
 *   фактический путь конфига для текста ошибки (`config.configFile`): литерал соврал бы,
 *   если конфиг лежит вне `.pi/` (ADR 0005, б).
 * @returns {{
 *   values: Record<string, number>,
 *   sources: Record<string, 'cli'|'env'|'config'|'default'>,
 * }}
 */
export function resolveLimits({
  config = null,
  configured = null,
  cli = {},
  env = process.env,
  defaults = {},
  configLabel = sourceLabel('config'),
} = {}) {
  const fromConfig =
    configured === null ? (config === null ? [] : Object.keys(config)) : [...configured];
  /** @type {Record<string, number>} */
  const values = {};
  /** @type {Record<string, 'cli'|'env'|'config'|'default'>} */
  const sources = {};

  for (const key of LIMIT_KEYS) {
    const cliValue = cli[key];
    if (cliValue !== undefined && cliValue !== null) {
      values[key] = checkLimitValue(key, cliValue, LIMIT_FLAGS[key] ?? key);
      sources[key] = 'cli';
      continue;
    }

    const envName = envNameFor(key);
    const envValue = env[envName];
    if (typeof envValue === 'string' && envValue.trim() !== '') {
      values[key] = checkLimitValue(key, envValue, envName);
      sources[key] = 'env';
      continue;
    }

    const configValue = config === null || !fromConfig.includes(key) ? undefined : config[key];
    if (configValue !== undefined) {
      values[key] = checkLimitValue(key, configValue, configLabel);
      sources[key] = 'config';
      continue;
    }

    const fallback = defaults[key];
    if (fallback === undefined) {
      throw new LimitsError(`limits.${key}: нет ни одного источника значения`);
    }
    values[key] = fallback;
    sources[key] = 'default';
  }

  return { values, sources };
}

/**
 * Компактная запись применённых лимитов для артефактов (`decision.<n>.json`, `metrics.json`).
 * @param {{ values: Record<string, number>, sources: Record<string, string> }} resolved
 * @returns {Record<string, { value: number, source: LimitSource }>}
 */
export function describedLimits({ values, sources }) {
  /** @type {Record<string, { value: number, source: LimitSource }>} */
  const described = {};
  for (const key of LIMIT_KEYS) {
    described[key] = {
      value: values[key] ?? 0,
      source: /** @type {LimitSource} */ (sources[key] ?? 'default'),
    };
  }
  return described;
}
