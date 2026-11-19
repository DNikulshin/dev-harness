/**
 * Стоимость прогона стадии и цикла по ценам провайдера (docs/evals.md).
 *
 * Модуль только считает: файлов не читает и не пишет, время и случайность не использует.
 * Входные документы (`prices.json`, `profiles.json`, `candidates.json`) разбираются
 * валидаторами этого же модуля — битые числа должны ломать расчёт, а не давать `NaN`
 * в отчёте, по которому принимают решение о деньгах.
 *
 * Модель расчёта повторяет то, как провайдер тарифицирует запрос: свежий вход, чтение
 * кэша и вывод считаются по своим ценам, а `reasoning` входит в `output` (отдельной
 * цены у рассуждений нет). Поэтому профиль стадии — это три числа, а не четыре:
 * `reasoning` хранится рядом для диагностики «сколько вывода — это размышления».
 *
 * Цены — в рублях за 1M токенов, как их отдаёт каталог провайдера. Никаких курсов
 * внутри нет: если провайдер отдаёт другую валюту, снапшот `prices.json` непригоден,
 * и `currency` из `_meta` обязан это показать.
 *
 * Shebang не нужен: модуль подключается из CLI-скриптов `evals-*.mjs`.
 */
/** Стадии, которые считаются в цикле. Порядок — порядок этапов автомата §5.3. */
export declare const STAGES: readonly string[];
/** Ожидаемая валюта снапшота цен: расчёт в рублях, курс внутри модуля не живёт. */
export declare const CURRENCY = "RUB";
export type ModelPrice = {
    /**
     * ₽ за 1M токенов свежего входа
     */
    input: number;
    /**
     * ₽ за 1M токенов вывода (включая рассуждения)
     */
    output: number;
    /**
     * ₽ за 1M токенов чтения кэша
     */
    cache_read: number;
    /**
     * ₽ за 1M токенов записи кэша
     */
    cache_write: number;
    /**
     * длина контекста в токенах
     */
    context: number;
};
export type StageProfile = {
    /**
     * вызовов модели на прогон стадии
     */
    calls_per_run: number;
    /**
     * токенов свежего входа на прогон
     */
    input: number;
    /**
     * токенов чтения кэша на прогон
     */
    cache_read: number;
    /**
     * токенов вывода на прогон (включая рассуждения)
     */
    output: number;
    /**
     * токенов рассуждений на прогон (часть `output`)
     */
    reasoning: number;
};
export type StageCost = {
    /**
     * идентификатор модели из `prices.json`
     */
    model: string;
    /**
     * ₽ за свежий вход
     */
    input: number;
    /**
     * ₽ за чтение кэша
     */
    cache_read: number;
    /**
     * ₽ за вывод
     */
    output: number;
    /**
     * сумма, ₽
     */
    total: number;
    /**
     * доля вывода, приходящаяся на рассуждения (0…1)
     */
    reasoning_share: number;
};
/**
 * Проверяет снапшот цен и возвращает его как есть (без копирования: модуль не мутирует).
 * @param {unknown} doc содержимое `evals/prices.json`
 * @returns {{ models: Record<string, ModelPrice>, meta: Record<string, unknown> }}
 */
export declare function readPrices(doc: unknown): {
    models: Record<string, ModelPrice>;
    meta: Record<string, unknown>;
};
/**
 * Проверяет профили нагрузки. Профиль — приближение: при смене модели меняется и
 * длина ответа, поэтому числа описывают стадию, а не модель.
 * @param {unknown} doc содержимое `evals/profiles.json`
 * @returns {{ stages: Record<string, StageProfile>, meta: Record<string, unknown> }}
 */
export declare function readProfiles(doc: unknown): {
    stages: Record<string, StageProfile>;
    meta: Record<string, unknown>;
};
/**
 * Дельты кандидатов: имя → набор стадий с моделями. Не указанная стадия берётся
 * из текущей конфигурации, поэтому кандидат — это эксперимент, а не второй конфиг.
 * @param {unknown} doc содержимое `evals/candidates.json`
 * @returns {Record<string, { note: string, models: Record<string, string> }>}
 */
export declare function readCandidates(doc: unknown): Record<string, {
    note: string;
    models: Record<string, string>;
}>;
/**
 * Наложение дельты кандидата на текущую конфигурацию.
 * @param {Record<string, string>} base модели по стадиям
 * @param {Record<string, string>} delta изменения
 * @returns {Record<string, string>} новая конфигурация
 */
export declare function applyDelta(base: Record<string, string>, delta: Record<string, string>): Record<string, string>;
/**
 * Стоимость одного прогона стадии. Проверка наличия модели и профиля — здесь, а не
 * в вызывающем коде: `undefined` в расчёте дал бы `NaN` в отчёте.
 * @param {{ prices: Record<string, ModelPrice> }} source проверенный снапшот
 * @param {string} model идентификатор модели
 * @param {StageProfile} profile профиль стадии
 * @returns {StageCost}
 */
export declare function priceStage({ prices }: {
    prices: Record<string, ModelPrice>;
}, model: string, profile: StageProfile): StageCost;
/**
 * Стоимость полного цикла: по одному прогону каждой стадии. Дополнительные итерации
 * `code` считаются отдельно вызывающим кодом: они зависят от исхода, а не от цен.
 * @param {{ prices: Record<string, ModelPrice>, profiles: Record<string, StageProfile> }} input
 * @param {Record<string, string>} models модели по стадиям
 * @returns {{ stages: Record<string, StageCost>, total: number }}
 */
export declare function priceCycle({ prices, profiles }: {
    prices: Record<string, ModelPrice>;
    profiles: Record<string, StageProfile>;
}, models: Record<string, string>): {
    stages: Record<string, StageCost>;
    total: number;
};
/**
 * Округление до копеек для показа. `-0` приводится к `0`: в таблице он читается как ошибка.
 * @param {number} value
 * @returns {number}
 */
export declare function roundRub(value: number): number;
/**
 * Число для таблицы: всегда два знака после запятой, без разделителей разрядов.
 * @param {number} value
 * @returns {string}
 */
export declare function formatRub(value: number): string;
/**
 * Знаковая дельта для таблицы: сравнение конфигураций читается глазами.
 * @param {number} value
 * @returns {string}
 */
export declare function formatDelta(value: number): string;
