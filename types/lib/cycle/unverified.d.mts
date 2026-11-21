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
export declare const UNVERIFIED_SOURCES: readonly string[];
/**
 * Источник одного пункта «не проверено» (#137). Разбор идёт по префиксу строки, а не по тексту
 * причины: формат строки задаёт `cycle-decide` (§5.6), причины — свободный текст.
 * @param {string} text пункт из `decision.unverified[]` или `evaluation.unverified[]`
 * @returns {'gate'|'unproven'|'criteria_missing'|'other'} источник факта
 */
export declare function unverifiedSource(text: string): 'gate' | 'unproven' | 'criteria_missing' | 'other';
/**
 * Текст в одну строку: пробельные последовательности, включая переводы строк, — один пробел.
 * @param {string} text
 * @returns {string}
 */
export declare function singleLine(text: string): string;
/**
 * Дедупликация пунктов «не проверено» из `decision.unverified[]` и
 * `evaluation.unverified[]`. Из пары остаётся более полная формулировка, позиция — первого
 * вхождения (порядок артефактов сохраняется, вывод детерминирован).
 * @param {string[]} items
 * @returns {string[]}
 */
export declare function dedupeUnverified(items: string[]): string[];
