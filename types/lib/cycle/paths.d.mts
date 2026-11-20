import { loadConfig } from './config.mjs';
/** Имена внутри каталога цикла, не зависящие от номера итерации. */
export declare const FIXED_NAMES: Readonly<{
    state: "state.json";
    followups: "followups.md";
    metrics: "metrics.json";
    usage: "usage.json";
    escalation: "escalation.json";
    qaWeb: "qa-web.json";
    issue: "issue.json";
    evidenceDir: "evidence";
    driverJournal: "driver.jsonl";
}>;
/**
 * Корень репозитория — единственный источник истины для всех относительных путей.
 * @returns {string} абсолютный путь без завершающего слэша
 */
export declare function repoRoot(): string;
/**
 * Каталог артефактов цикла. Путь берётся из конфига проекта (`paths.artifactsDir`),
 * по умолчанию `.pi/artifacts`.
 * @param {string} [root] корень репозитория; по умолчанию определяется через git
 * @param {ReturnType<typeof loadConfig>} [config] конфиг проекта; по умолчанию загружается
 * @returns {string}
 */
export declare function artifactsDir(root?: string, config?: ReturnType<typeof loadConfig>): string;
export type CycleDirNameParams = {
    /**
     * дата начала цикла, `YYYY-MM-DD`
     */
    date: string;
    /**
     * номер issue
     */
    issue: number | string;
    /**
     * короткий латинский идентификатор задачи
     */
    slug: string;
};
/**
 * @typedef {object} CycleDirNameParams
 * @property {string} date дата начала цикла, `YYYY-MM-DD`
 * @property {number|string} issue номер issue
 * @property {string} slug короткий латинский идентификатор задачи
 */
/**
 * Имя каталога цикла: `<date>-<issue>-<slug>` (как в `.pi/artifacts/`).
 * @param {CycleDirNameParams} params
 * @returns {string}
 */
export declare function cycleDirName({ date, issue, slug }: CycleDirNameParams): string;
/**
 * Имена файлов с номером итерации. Нумерация с единицы: `<name>.<n>.<ext>`.
 * @param {number} iteration номер итерации, целое ≥ 1
 * @returns {{
 *   plan: string,
 *   codeReport: string,
 *   reworkBrief: string,
 *   reviewMd: string,
 *   reviewJson: string,
 *   evaluationMd: string,
 *   evaluationJson: string,
 *   decision: string,
 *   gates: string,
 * }}
 */
export declare function iterNames(iteration: number): {
    plan: string;
    codeReport: string;
    reworkBrief: string;
    reviewMd: string;
    reviewJson: string;
    evaluationMd: string;
    evaluationJson: string;
    decision: string;
    gates: string;
};
/**
 * Единственный активный цикл в каталоге артефактов: подкаталог со `state.json`,
 * у которого `stage` не `DONE` и не `ESCALATED`. Ноль или несколько — ошибка:
 * неоднозначность должна ломать цикл, а не разрешаться угадыванием.
 * @param {string} [dir] каталог артефактов; по умолчанию `.pi/artifacts/` репозитория
 * @returns {string} путь к каталогу активного цикла
 */
export declare function findActiveCycle(dir?: string): string;
