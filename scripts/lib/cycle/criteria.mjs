/**
 * Критерии приёмки: разбор `evidence/criteria.md` и дайджест для заморозки (§5.4, §5.3).
 *
 * Один разбор на три потребителя — `cycle-evidence` (пишет файл), `cycle-state`
 * (`freeze-criteria` закрепляет дайджест в `state.json`) и `cycle-decide` (сверяет
 * цель решения с закреплённой). Копия разбора в каждом скрипте разошлась бы молча:
 * дайджест считается по разобранным пунктам, поэтому расхождение парсеров выглядело бы
 * как дрейф критериев.
 *
 * Формат строки — строчный контракт §5.4: `- C1: формулировка`, по строке на критерий.
 * Порядок пунктов значим: id привязаны к формулировкам, перестановка меняет смысл
 * таблицы в PR (`cycle-pr-body` печатает критерии в порядке файла).
 */
import { createHash } from 'node:crypto';

/** Имя файла критериев в каталоге свидетельств (§5.1 `evidence/criteria.md`). */
export const CRITERIA_FILE = 'criteria.md';

/**
 * Источник критериев, при котором цель цикла может измениться — только по решению
 * владельца (§5.3 `state.criteria_source`).
 */
export const CRITERIA_OWNER_APPROVED = 'plan_owner_approved';

/** Строка `evidence/criteria.md`: `- C1: формулировка` (§5.4). */
export const CRITERION_LINE = /^-[ \t]+(C[1-9]\d*):[ \t]*(.*)$/;

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
export function parseCriteria(markdown) {
  if (typeof markdown !== 'string') throw new TypeError('parseCriteria: ожидается строка');

  /** @type {Criterion[]} */
  const criteria = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = CRITERION_LINE.exec(line.trim());
    const id = match?.[1];
    const text = match?.[2];
    if (id !== undefined && text !== undefined) criteria.push({ id, text: text.trim() });
  }
  return criteria;
}

/**
 * Закреплённый дайджест критериев из `state.json`: `null`, если заморозки не было (старый цикл
 * или цикл до шага `freeze-criteria`).
 * @param {Record<string, any>} state проверенное состояние
 * @returns {string|null}
 */
export function frozenDigest(state) {
  return typeof state.criteria_sha256 === 'string' ? state.criteria_sha256 : null;
}

/**
 * Дрейф цели: `null`, если заморозки нет или критерии совпадают с закреплёнными, иначе —
 * закреплённый дайджест. Чистая функция: файлы читает вызывающий, поэтому одна проверка
 * работает и в `cycle-decide` (файл — вход решения), и в `cycle-evidence packet` (вход судьи),
 * и в `cycle-pr-body` (публикуемая цель), и в `cycle-evidence criteria` (критерии из issue).
 * @param {readonly Criterion[]} criteria критерии в актуальном виде
 * @param {Record<string, any>} state проверенное состояние
 * @returns {string|null}
 */
export function criteriaMismatch(criteria, state) {
  const frozen = frozenDigest(state);
  if (frozen === null) return null;
  return frozen === criteriaDigest(criteria) ? null : frozen;
}

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
export function unratedCriterionIds(criteria, rated) {
  if (!Array.isArray(criteria)) {
    throw new TypeError('unratedCriterionIds: ожидается массив критериев');
  }

  /** @type {Set<string>} */
  const ratedIds = new Set();
  if (Array.isArray(rated)) {
    for (const item of rated) {
      if (item !== null && typeof item === 'object' && typeof item.id === 'string') {
        ratedIds.add(item.id);
      }
    }
  }

  return criteria
    .filter((criterion) => !ratedIds.has(criterion.id))
    .map((criterion) => criterion.id);
}

/**
 * `sha256` канонической формы критериев: пары `[id, text]` в порядке файла.
 *
 * Канон — не текст файла, а именно пары: заголовок, источник (`Источник: секция …`) и
 * форматирование `criteria.md` в дайджест не входят, иначе правка косметики выглядела бы
 * дрейфом. Формулировки берутся дословно, поэтому изменение формулировки — дрейф.
 * @param {readonly Criterion[]} criteria
 * @returns {string} hex-дайджест
 */
export function criteriaDigest(criteria) {
  if (!Array.isArray(criteria)) throw new TypeError('criteriaDigest: ожидается массив');

  const canonical = JSON.stringify(criteria.map((criterion) => [criterion.id, criterion.text]));
  return createHash('sha256').update(canonical).digest('hex');
}
