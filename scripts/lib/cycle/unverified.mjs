/**
 * Пункты «не проверено»: нормализация и дедупликация (`docs/orchestrator-core.md` §5.6–5.7, #204).
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
