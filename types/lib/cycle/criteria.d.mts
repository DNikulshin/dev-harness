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
 * Закреплённый дайджест критериев из `state.json`: `null`, если заморозки не было (старый цикл
 * или цикл до шага `freeze-criteria`).
 * @param {Record<string, any>} state проверенное состояние
 * @returns {string|null}
 */
export declare function frozenDigest(state: Record<string, any>): string | null;
/**
 * Дрейф цели: `null`, если заморозки нет или критерии совпадают с закреплёнными, иначе —
 * закреплённый дайджест. Чистая функция: файлы читает вызывающий, поэтому одна проверка
 * работает и в `cycle-decide` (файл — вход решения), и в `cycle-evidence packet` (вход судьи),
 * и в `cycle-pr-body` (публикуемая цель), и в `cycle-evidence criteria` (критерии из issue).
 * @param {readonly Criterion[]} criteria критерии в актуальном виде
 * @param {Record<string, any>} state проверенное состояние
 * @returns {string|null}
 */
export declare function criteriaMismatch(criteria: readonly Criterion[], state: Record<string, any>): string | null;
/**
 * Критерии из `criteria.md`, по которым оценщик не дал статуса. Одна проверка на два
 * потребителя: `cycle-decide` (решение не выдаётся по неполному оцениванию) и
 * `cycle-pr-body` (таблица критериев обязана показать статус каждого).
 *
 * Порядок — как в `criteria.md`: он задаёт вывод и сообщение об ошибке. Лишние `id`
 * в `evaluation.criteria` не являются ошибкой: оценщик вправе завести свой пункт, но
 * полноту это не восполняет. Форма `evaluation.criteria` не гарантирована (документ
 * приходит от агента), поэтому разбор терпимый: элемент без строкового `id` не считается
 * статусом ни для одного критерия.
 * @param {readonly Criterion[]} criteria критерии из `evidence/criteria.md`
 * @param {unknown} rated `evaluation.criteria`
 * @returns {string[]} `id` без статуса в порядке `criteria.md`
 */
export declare function unratedCriterionIds(criteria: readonly Criterion[], rated: unknown): string[];
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
