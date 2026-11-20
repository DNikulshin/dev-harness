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
export type LimitSource = 'cli' | 'env' | 'config' | 'default';
/**
 * Источник значения лимита: от него зависит и текст причины, и вид артефакта.
 * @typedef {'cli'|'env'|'config'|'default'} LimitSource
 */
/** Ошибка конфигурации лимитов: скрипты цикла превращают её в код 2. */
export declare class LimitsError extends Error {
}
/**
 * Ключи лимитов и правила проверки. `integer` — целое (дроби не допускаются, кроме бюджета),
 * `min`/`max` — допустимый диапазон. Бюджет — рубли, допускает дробное значение.
 * @type {Readonly<Record<string, { integer: boolean, min: number, max: number }>>}
 */
export declare const LIMIT_RULES: Readonly<Record<string, {
    integer: boolean;
    min: number;
    max: number;
}>>;
/** Ключи лимитов в нормативном порядке. */
export declare const LIMIT_KEYS: readonly string[];
/**
 * CLI-флаги, переопределяющие лимиты. На остальные ключи флагов нет: интерфейс скриптов не
 * должен разрастаться, для них есть переменные окружения.
 * @type {Readonly<Record<string, string>>}
 */
export declare const LIMIT_FLAGS: Readonly<Record<string, string>>;
/**
 * Имя переменной окружения для ключа: `HARNESS_LIMIT_<SNAKE_UPPER>`.
 * @param {string} key
 * @returns {string}
 */
export declare function envNameFor(key: string): string;
/**
 * Источник лимита по-русски: для текста причины, а не для машины.
 * @param {'cli'|'env'|'config'|'default'} source
 * @returns {string}
 */
export declare function sourceLabel(source: 'cli' | 'env' | 'config' | 'default'): string;
/**
 * Проверяет одно значение лимита.
 * @param {string} key
 * @param {unknown} value
 * @param {string} source человекочитаемый источник (для текста ошибки)
 * @returns {number}
 */
export declare function checkLimitValue(key: string, value: unknown, source: string): number;
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
export declare function resolveLimits({ config, configured, cli, env, defaults, configLabel, }?: {
    config?: Record<string, number> | null;
    configured?: readonly string[] | null;
    cli?: Record<string, unknown>;
    env?: Record<string, string | undefined>;
    defaults?: Readonly<Record<string, number>>;
    configLabel?: string;
}): {
    values: Record<string, number>;
    sources: Record<string, 'cli' | 'env' | 'config' | 'default'>;
};
/**
 * Компактная запись применённых лимитов для артефактов (`decision.<n>.json`, `metrics.json`).
 * @param {{ values: Record<string, number>, sources: Record<string, string> }} resolved
 * @returns {Record<string, { value: number, source: LimitSource }>}
 */
export declare function describedLimits({ values, sources }: {
    values: Record<string, number>;
    sources: Record<string, string>;
}): Record<string, {
    value: number;
    source: LimitSource;
}>;
