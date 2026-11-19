/**
 * Валидаторы схем артефактов цикла (docs/orchestrator-core.md, Приложение A).
 *
 * Ручной код без Zod и новых зависимостей (D6). Сигнатура каждого валидатора —
 * `(doc) → { ok, errors[] }`: лишние поля игнорируются, отсутствующие обязательные
 * считаются ошибкой. Проверяется только структура: разрешение ссылок — `refs.mjs`,
 * маскирование — `redact.mjs`.
 * Общие хелперы: `req()` (обязательное поле), `int()` (целое в границах),
 * `oneOf()` (перечисление; имя `enum` в ESM недоступно — зарезервированное слово).
 * Shebang не нужен: модуль подключается из CLI-скриптов `cycle-*.mjs`.
 */
export type ValidationResult = {
    ok: boolean;
    errors: string[];
};
/**
 * `state.json` (Приложение A). Счётчики `retries` — целые ≥ 0, `iteration` не больше
 * `max_iterations`, кроме случая явного одобрения владельца (`owner_approved`).
 * @param {unknown} doc
 * @returns {ValidationResult}
 */
export declare function validateState(doc: unknown): ValidationResult;
/**
 * `gates.<n>.json` (§5.5).
 * @param {unknown} doc
 * @returns {ValidationResult}
 */
export declare function validateGates(doc: unknown): ValidationResult;
/**
 * Блок `json` из `review.<n>.md` (Приложение A).
 * @param {unknown} doc
 * @returns {ValidationResult}
 */
export declare function validateReview(doc: unknown): ValidationResult;
/**
 * Блок `json` из `evaluation.<n>.md` (Приложение A).
 * @param {unknown} doc
 * @returns {ValidationResult}
 */
export declare function validateEvaluation(doc: unknown): ValidationResult;
/**
 * `qa-web.json` — сырые данные браузерной проверки (`docs/qa-web.md`).
 * @param {unknown} doc
 * @returns {ValidationResult}
 */
export declare function validateQaWeb(doc: unknown): ValidationResult;
/**
 * `decision.<n>.json` (§5.6). Списки — массивы непустых строк: `reasons`, `acquire`,
 * `rework_items`, `unverified`, `downgraded`.
 * @param {unknown} doc
 * @returns {ValidationResult}
 */
export declare function validateDecision(doc: unknown): ValidationResult;
/**
 * `escalation.json` (Приложение A, словарь причин D7).
 * @param {unknown} doc
 * @returns {ValidationResult}
 */
export declare function validateEscalation(doc: unknown): ValidationResult;
/**
 * `metrics.json` (Приложение A, §5.8). Метрика считается за весь цикл: длительности
 * этапов и гейтов, исходы гейтов, счётчики серьёзности, сопоставление находок ревью
 * с дефектами оценщика. `tokens` и `cost_rub` — факты расхода (§5.8): `tokens`
 * заполняется из `usage.json` (пишет `cycle-usage` по транскриптам субагентов),
 * `cost_rub` — те же токены по `evals/prices.json`. Оба `null`, когда замера нет:
 * `null` значит «не измеряли», а не «ноль». Частичный расход тоже даёт `null`:
 * неполная сумма выдавала бы себя за полную.
 *
 * Ключи `stage_durations_s` — имена этапов автомата §5.3, ключи `gate_durations_s`
 * и `gate_outcomes` — идентификаторы гейтов §5.5. Значения длительностей — секунды
 * (число ≥ 0 c точностью до 3 знаков; точность держит писатель, схема её не проверяет).
 *
 * Кроме типов проверяются обязательные равенства Приложения A: `cycle_duration_s`
 * равен сумме `stage_durations_s`, `gate_total_s` — сумме `gate_durations_s`. Сравнение
 * с допуском `DURATION_TOLERANCE` (писатель складывает уже округлённые слагаемые)
 * и только для тех карт, которые прошли проверку целиком.
 * @param {unknown} doc
 * @returns {ValidationResult}
 */
export declare function validateMetrics(doc: unknown): ValidationResult;
