/** Путь протокола относительно корня репозитория. */
export declare const PREREGISTRATION_PATH = "evals/preregistration.md";
/** Минимум повторов из §15: меньше — это наблюдение, а не измерение. */
export declare const MIN_REPEATS = 3;
export type Preregistration = {
    /**
     * версия протокола, целое ≥ 1
     */
    version: number;
    /**
     * дата начала действия, `YYYY-MM-DD`
     */
    since: string;
    /**
     * минимум повторов на ячейку «сид + стадия»
     */
    min_repeats: number;
    thresholds: {
        completeness: number;
        false_positive_max: number;
        line_tolerance: number;
    };
    /**
     * id сидов набора
     */
    seeds: string[];
};
/**
 * Достаёт единственный `json`-блок из markdown протокола.
 * @param {unknown} markdown
 * @returns {{ text: string|null, errors: string[] }} `text` — содержимое блока без ограждения
 */
export declare function extractPreregistrationBlock(markdown: unknown): {
    text: string | null;
    errors: string[];
};
/**
 * Разбирает блок и проверяет схему протокола.
 * @param {unknown} block содержимое блока (уже без ограждения)
 * @returns {{ ok: boolean, errors: string[], prereg: Preregistration|null }}
 */
export declare function readPreregistration(block: unknown): {
    ok: boolean;
    errors: string[];
    prereg: Preregistration | null;
};
/**
 * Читает протокол из файла: ограждение, JSON и схема — с одним сообщением на все ошибки.
 * @param {string} file абсолютный путь к `preregistration.md`
 * @returns {Preregistration}
 */
export declare function loadPreregistration(file: string): Preregistration;
