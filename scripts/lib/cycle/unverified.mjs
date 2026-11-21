/**
 * Пункты «не проверено»: нормализация и дедупликация (`docs/orchestrator-core.md` §5.6–5.7).
 *
 * Один и тот же факт приходит из двух артефактов: `cycle-decide` пишет в `decision.unverified[]`
 * строку `evaluation unverified: <what>`, а `evaluation.unverified[]` хранит `what` и `why`
 * (§5.6). Считать его дважды нельзя — ни в блоке «не проверено» тела PR, ни в числе пунктов
 * отчёта. Сравнение идёт по нормализованной форме: без префикса источника и без разницы
 * в регистре и пробелах.
 *
 * Модуль общий для `cycle-pr-body` (чекбоксы владельцу в PR) и `cycle-report` (сколько пунктов
 * осталось и какая доля решений принята без проверки). Правило одно: разойтись двум отчётам
 * об одном и том же прогоне негде.
 *
 * Shebang не нужен: модуль подключается из CLI-скриптов.
 */

/**
 * Префикс источника в `decision.unverified[]` (§5.6): `evaluation unverified: <what>` и
 * `unproven: <id> [<SEV>] <причина>` (#125). При сравнении снимается — иначе тот же факт
 * из `evaluation.unverified[]` считался бы новым.
 */
const SOURCE_PREFIX = /^(?:(?:evaluation|review|decision)[ \t]+unverified:|unproven:)[ \t]*/iu;

/**
 * Источники пунктов «не проверено» (#137, `docs/orchestrator-core.md` §5.8a): по какой причине
 * факт остался непроверенным. Список — **разрез**, а не перечисление строк: каждый пункт
 * попадает ровно в одну группу, поэтому сумма групп всегда равна числу пунктов.
 *
 * - `gate` — гейт не запущен: `gate:<id> not_run` (§5.6);
 * - `unproven` — недоказанный факт, критерий `partial`, `REWORK` без блокера: `unproven: …`
 *   (#125, ADR 0011);
 * - `criteria_missing` — критерий замороженного `criteria.md` без статуса: `criteria:<id> missing`
 *   (#124);
 * - `other` — остальное: `criteria:<id> unverified`, `evaluation unverified:`, `qa-web not_run`,
 *   `integrity:` и любые новые строки.
 *
 * Сравнивать базы замеров между собой можно только по этому разрезу (#137, ADR 0012): состав
 * `items` менялся (#124, #125), поэтому сумма пунктов и доля решений без проверки между базами
 * несопоставимы.
 */
export const UNVERIFIED_SOURCES = Object.freeze(['gate', 'unproven', 'criteria_missing', 'other']);

/** Гейт не запущен: `gate:<id> not_run` (§5.6). `skipped` сюда не попадает. */
const GATE_NOT_RUN = /^gate:\S+\s+not_run\b/u;

/** Понижение по «не доказано» (#125, ADR 0011): `unproven: <id> [<SEV>] <причина>`. */
const UNPROVEN = /^unproven:/iu;

/** Критерий замороженного `criteria.md` без статуса в оценке (#124): `criteria:<id> missing`. */
const CRITERIA_MISSING = /^criteria:\S+\s+missing\b/u;

/**
 * Источник одного пункта «не проверено» (#137). Разбор идёт по префиксу строки, а не по тексту
 * причины: формат строки задаёт `cycle-decide` (§5.6), причины — свободный текст.
 * @param {string} text пункт из `decision.unverified[]` или `evaluation.unverified[]`
 * @returns {'gate'|'unproven'|'criteria_missing'|'other'} источник факта
 */
export function unverifiedSource(text) {
  const line = singleLine(text);
  if (GATE_NOT_RUN.test(line)) return 'gate';
  if (UNPROVEN.test(line)) return 'unproven';
  if (CRITERIA_MISSING.test(line)) return 'criteria_missing';
  return 'other';
}

/**
 * Непустая строка после обрезки пробелов.
 * @param {unknown} value
 * @returns {value is string} сужает тип вызывающего кода
 */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Текст в одну строку: пробельные последовательности, включая переводы строк, — один пробел.
 * @param {string} text
 * @returns {string}
 */
export function singleLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Нормализованная форма пункта «не проверено»: без префикса источника и без разницы
 * в регистре/пробелах. Сравнение по ней, а не по сырому тексту — иначе формулировки
 * одного и того же факта из двух артефактов считаются разными.
 * @param {string} text
 * @returns {string}
 */
function unverifiedKey(text) {
  return singleLine(text).replace(SOURCE_PREFIX, '').toLowerCase();
}

/**
 * Один ли это факт в двух формулировках: точное совпадение или более короткая версия —
 * начало более полной на границе слова (`<what>` против `<what> — <why>`).
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function sameUnverified(left, right) {
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (!longer.startsWith(shorter)) return false;
  return /^[\s—–-]/u.test(longer.slice(shorter.length));
}

/**
 * Дедупликация пунктов «не проверено» из `decision.unverified[]` и
 * `evaluation.unverified[]`. Из пары остаётся более полная формулировка, позиция — первого
 * вхождения (порядок артефактов сохраняется, вывод детерминирован).
 * @param {string[]} items
 * @returns {string[]}
 */
export function dedupeUnverified(items) {
  if (!Array.isArray(items)) throw new TypeError('dedupeUnverified: ожидается массив');

  /** @type {{ key: string, text: string }[]} */
  const kept = [];
  for (const item of items) {
    if (!isText(item)) continue;
    const text = singleLine(item);
    const key = unverifiedKey(text);
    const index = kept.findIndex((entry) => sameUnverified(entry.key, key));
    const existing = kept[index];
    if (existing === undefined) kept.push({ key, text });
    else if (text.length > existing.text.length) kept[index] = { key, text };
  }

  return kept.map((entry) => entry.text);
}
