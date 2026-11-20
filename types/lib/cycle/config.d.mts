/** Имя файла конфигурации относительно корня проекта. */
export declare const CONFIG_FILE: Readonly<{
    dir: ".pi";
    name: "harness.config.json";
}>;
/** Флаг границы CLI: путь к файлу конфига (ADR 0005, б). */
export declare const CONFIG_FLAG = "--config";
/** Переменная окружения для случаев, где флаг передать некуда; флаг важнее её. */
export declare const CONFIG_ENV = "HARNESS_CONFIG";
/** Ошибка конфигурации: код 2 у скриптов цикла — ошибка использования, а не падение. */
export declare class ConfigError extends Error {
    code: number;
    /**
     * @param {string} message
     */
    constructor(message: string);
}
/** Встроенные гейты ядра: единственное значение `builtin`, известное `cycle-gates`. */
export declare const BUILTIN_GATES: readonly string[];
/**
 * Нейтральные значения по умолчанию. Гейтов здесь нет намеренно: список проверок —
 * свойство проекта, а не ядра.
 */
export declare const DEFAULTS: {
    gates: never[];
    limits: {
        maxDiffLines: number;
        maxDiffBytes: number;
        logMaxBytes: number;
        evidenceTailLines: number;
        defaultMaxIterations: number;
        maxCycleCostRub: number;
    };
    paths: {
        artifactsDir: string;
        evidenceDir: string;
        gatesDir: string;
        agentsDir: string;
        agentsMd: string;
        settings: string;
        cyclePrompt: string;
        prTemplate: string;
    };
    qaWeb: {
        pathPrefixes: never[];
    };
    evals: {
        prices: string;
        profiles: string;
        candidates: string;
        seedsDir: string;
    };
    integrity: {
        testPaths: never[];
        protectedPaths: never[];
    };
    provider: string;
    gateTimeouts: {};
};
export type LoadedGate = {
    id: string;
    /**
     * команда без оболочки (`null` — встроенная проверка)
     */
    executable: string | null;
    /**
     * аргументы без интерполяции
     */
    args: readonly string[];
    /**
     * команда строкой для `gates.<n>.json` (`null` — builtin)
     */
    cmd: string | null;
    /**
     * встроенная проверка ядра
     */
    builtin: string | null;
    required: boolean;
    dependsOn: readonly string[];
    pathPrefixes: readonly string[];
    /**
     * класс отказа по логу: нет базы → `not_run` с `no_database`
     */
    dbGate: boolean;
};
export type Limits = {
    maxDiffLines: number;
    maxDiffBytes: number;
    logMaxBytes: number;
    evidenceTailLines: number;
    defaultMaxIterations: number;
    maxCycleCostRub: number;
};
export type Paths = {
    artifactsDir: string;
    evidenceDir: string;
    gatesDir: string;
    agentsDir: string;
    agentsMd: string;
    settings: string;
    cyclePrompt: string;
    /**
     * пустая строка — шаблон PR не задан
     */
    prTemplate: string;
};
export type EvalsPaths = {
    prices: string;
    profiles: string;
    candidates: string;
    seedsDir: string;
};
export type IntegrityRules = {
    /**
     * правила путей тестов
     */
    testPaths: readonly string[];
    /**
     * правила защищённых файлов
     */
    protectedPaths: readonly string[];
};
/**
 * Абсолютный путь конфига и его метка для диагностики.
 * @param {string} root корень проекта
 * @param {string|null} file путь из `--config`/окружения (`null` — умолчание)
 * @returns {{ file: string, label: string }}
 */
export declare function resolveConfigPath(root: string, file?: string | null): {
    file: string;
    label: string;
};
/**
 * Забирает из аргументов CLI флаг `--config <file>` (и его форму `--config=<file>`), а из
 * окружения — `HARNESS_CONFIG`. Один резолвер на все `bin` (ADR 0005, б): остальные
 * парсеры аргументов флага не знают и увидят аргументы уже без него.
 *
 * Приоритет: флаг важнее окружения — явное действие сильнее настроенной среды. Флаг без
 * значения, заданный дважды, `--config=` с пустым значением — ошибка с кодом 2, а не
 * молчаливый откат к умолчанию. Пустой `HARNESS_CONFIG` считается незаданным: пустую
 * переменную легко получить из окружения, где её выключили.
 * @param {readonly string[]} [argv] аргументы CLI
 * @param {Record<string, string|undefined>} [env] окружение
 * @returns {{ file: string|null, argv: string[] }} путь конфига и аргументы без флага
 */
export declare function takeConfigOption(argv?: readonly string[], env?: Record<string, string | undefined>): {
    file: string | null;
    argv: string[];
};
/**
 * Загружает конфигурацию проекта. Отсутствующий файл даёт `DEFAULTS`; частичные секции
 * дополняются дефолтами. Результат заморожен.
 * @param {string} root корень проекта
 * @param {{ file?: string|null, allowMissing?: boolean }} [options] `file` — путь конфига из
 *   `--config`/`HARNESS_CONFIG` (`null` — умолчание); относительный путь считается от `root`,
 *   как и все остальные пути ядра. `allowMissing` — вызывающий сам создаёт файл по этому пути
 *   (`harness-init` ставит пример конфига): отсутствие тогда даёт дефолты, а не ошибку
 * @returns {Readonly<{
 *   gates: ReadonlyArray<LoadedGate>,
 *   limits: Limits,
 *   limitsExplicit: readonly string[],
 *   paths: Paths,
 *   evals: EvalsPaths,
 *   qaWeb: { pathPrefixes: readonly string[] },
 *   integrity: IntegrityRules,
 *   provider: string,
 *   gateTimeouts: Record<string, number>,
 *   configFile: string,
 *   configPath: string,
 * }>}
 *   `configFile` — метка фактического пути конфига для сообщений (относительно корня или
 *   абсолютная, если конфиг вне дерева), `configPath` — абсолютный путь.
 */
export declare function loadConfig(root: string, { file, allowMissing }?: {
    file?: string | null;
    allowMissing?: boolean;
}): Readonly<{
    gates: ReadonlyArray<LoadedGate>;
    limits: Limits;
    limitsExplicit: readonly string[];
    paths: Paths;
    evals: EvalsPaths;
    qaWeb: {
        pathPrefixes: readonly string[];
    };
    integrity: IntegrityRules;
    provider: string;
    gateTimeouts: Record<string, number>;
    configFile: string;
    configPath: string;
}>;
