/** Имя файла конфигурации относительно корня проекта. */
export declare const CONFIG_FILE: Readonly<{
    dir: ".pi";
    name: "harness.config.json";
}>;
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
/**
 * Ошибка конфигурации. Код 2 совпадает с кодом выхода CLI: ошибка использования, а не
 * падение инструмента.
 */
export declare class ConfigError extends Error {
    code: number;
    /**
     * @param {string} message
     */
    constructor(message: string);
}
/**
 * Загружает конфигурацию проекта. Отсутствующий файл даёт `DEFAULTS`; частичные секции
 * дополняются дефолтами. Результат заморожен.
 * @param {string} root корень проекта
 * @returns {Readonly<{
 *   gates: ReadonlyArray<LoadedGate>,
 *   limits: Limits,
 *   limitsExplicit: readonly string[],
 *   paths: Paths,
 *   evals: EvalsPaths,
 *   qaWeb: { pathPrefixes: readonly string[] },
 *   provider: string,
 *   gateTimeouts: Record<string, number>,
 * }>}
 */
export declare function loadConfig(root: string): Readonly<{
    gates: ReadonlyArray<LoadedGate>;
    limits: Limits;
    limitsExplicit: readonly string[];
    paths: Paths;
    evals: EvalsPaths;
    qaWeb: {
        pathPrefixes: readonly string[];
    };
    provider: string;
    gateTimeouts: Record<string, number>;
}>;
