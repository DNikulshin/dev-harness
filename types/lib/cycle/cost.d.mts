/** Этапы, на которых вызывается модель: только у них бывает расход токенов. */
export declare const MODEL_STAGES: readonly string[];
/**
 * Плоский объект: массивы и `null` объектами не считаются.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>} сужает тип вызывающего кода
 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export type StageUsage = {
    runs: number;
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
    reasoning: number;
};
/**
 * Расход одного этапа (§5.4): счётчики целые ≥ 0.
 * @typedef {object} StageUsage
 * @property {number} runs
 * @property {number} input
 * @property {number} cache_read
 * @property {number} cache_write
 * @property {number} output
 * @property {number} reasoning
 */
/**
 * Человекочитаемая причина ошибки чтения.
 * @param {unknown} error
 * @returns {string}
 */
export declare function describeReadError(error: unknown): string;
/**
 * Причина ошибки разбора JSON без пути и без фрагмента текста: сообщение парсера
 * содержит начало файла, а в нём может оказаться путь.
 * @param {unknown} error
 * @returns {string}
 */
export declare function describeJsonError(error: unknown): string;
/**
 * Токены из `usage.json` в вид `metrics.json`: целые числа, ключи стадий в порядке
 * автомата. Лишние ключи — ошибка данных: неизвестный этап означал бы, что расход
 * посчитан не по тому словарю, и молча потерять его нельзя.
 * @param {unknown} usage содержимое `usage.json`
 * @returns {Record<string, StageUsage>}
 */
export declare function normalizeUsage(usage: unknown): Record<string, StageUsage>;
/**
 * Ключ модели в снапшоте цен.
 *
 * `state.models` хранит идентификатор с префиксом провайдера (`acme-ai/z-ai/glm-5.3` —
 * этого требует H4), а `evals/prices.json` — без него. Точное совпадение проверяется
 * первым, чтобы не зависеть от формы записи; затем пробуется вариант без первого сегмента.
 * `null` — модели нет в снапшоте, считать не по чему.
 * @param {unknown} model как записано в `state.models` (нестрока — `null`)
 * @param {Record<string, unknown>} prices снапшот цен
 * @returns {string|null}
 */
export declare function priceKeyFor(model: unknown, prices: Record<string, unknown>): string | null;
/**
 * Стоимость расхода по ценам и моделям этапов.
 * @param {Record<string, StageUsage>} tokens нормализованный расход
 * @param {Record<string, unknown>} models `state.models`
 * @param {Record<string, import('../evals/cost.mjs').ModelPrice>} prices снапшот цен
 * @returns {number|null} рубли с копейками или `null`, если считать не по чему
 */
export declare function priceUsage(tokens: Record<string, StageUsage>, models: Record<string, unknown>, prices: Record<string, import('../evals/cost.mjs').ModelPrice>): number | null;
/**
 * Необязательный `usage.json` каталога цикла: файла нет — замера нет (`null`),
 * битый файл — отказ: испорченный расход исказил бы стоимость молча.
 * @param {string} dir каталог цикла
 * @returns {Record<string, any>|null}
 */
export declare function readUsage(dir: string): Record<string, any> | null;
/**
 * Снапшот цен из репозитория. Отсутствие файла — не ошибка: цикл мог пройти до
 * появления снапшота, и тогда стоимость остаётся `null`, а токены заполняются.
 * Битый снапшот — отказ: цены влияют на бюджетные пороги, тихо игнорировать их нельзя.
 * @param {string} root корень репозитория
 * @returns {Record<string, import('../evals/cost.mjs').ModelPrice>|null}
 */
export declare function readPriceSnapshot(root: string, pricesPath?: string): Record<string, import('../evals/cost.mjs').ModelPrice> | null;
/**
 * Стоимость цикла по накопленному `usage.json` — вход бюджетного порога (§5.6, правило 7).
 * `null` означает «замера нет»: нет `usage.json`, пустой расход или модели/цены неизвестны.
 * Ноль вместо `null` был бы враньём — бюджет проверялся бы по несуществующим данным.
 * @param {{ dir: string, models: unknown, prices: Record<string, import('../evals/cost.mjs').ModelPrice>|null }} options
 * @returns {number|null} рубли с копейками или `null`
 */
export declare function cycleCostRub({ dir, models, prices }: {
    dir: string;
    models: unknown;
    prices: Record<string, import('../evals/cost.mjs').ModelPrice> | null;
}): number | null;
