/** Имя файла критериев в каталоге свидетельств (§5.1 `evidence/criteria.md`). */
export declare const CRITERIA_FILE = "criteria.md";
/**
 * Источник критериев, при котором цель цикла может измениться — только по решению
 * владельца (§5.3 `state.criteria_source`).
 */
export declare const CRITERIA_OWNER_APPROVED = "plan_owner_approved";
/** Строка `evidence/criteria.md`: `- C1: формулировка` (§5.4). */
export declare const CRITERION_LINE: RegExp;
export type Criterion = {
    /**
     * `C1`, `C2`, …
     */
    id: string;
    /**
     * формулировка критерия
     */
    text: string;
};
/**
 * @typedef {object} Criterion
 * @property {string} id `C1`, `C2`, …
 * @property {string} text формулировка критерия
 */
/**
 * Критерии из `evidence/criteria.md` в её порядке: по строке `- C1: формулировка` на
 * критерий. Пустой результат — не ошибка разбора: решение о полноте принимает вызывающий
 * (`cycle-evidence` требует хотя бы один критерий, `cycle-pr-body` тоже).
 * @param {string} markdown
 * @returns {Criterion[]}
 */
export declare function parseCriteria(markdown: string): Criterion[];
/**
 * `sha256` канонической формы критериев: пары `[id, text]` в порядке файла.
 *
 * Канон — не текст файла, а именно пары: заголовок, источник (`Источник: секция …`) и
 * форматирование `criteria.md` в дайджест не входят, иначе правка косметики выглядела бы
 * дрейфом. Формулировки берутся дословно, поэтому изменение формулировки — дрейф.
 * @param {readonly Criterion[]} criteria
 * @returns {string} hex-дайджест
 */
export declare function criteriaDigest(criteria: readonly Criterion[]): string;
