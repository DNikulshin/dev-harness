/**
 * Записи транскрипта. Битые строки пропускаются: файл пишется во время работы агента,
 * и последняя строка может быть недописана.
 * @param {string} file
 * @returns {Array<Record<string, any>>}
 */
export declare function readTranscript(file: string): Array<Record<string, any>>;
/**
 * Текст последнего ответа ассистента. Собираются только текстовые части: вызовы
 * инструментов в ответ не входят, как и в живой записи `review.<n>.md`.
 * @param {Array<Record<string, any>>} records
 * @returns {string}
 */
export declare function lastAssistantText(records: Array<Record<string, any>>): string;
/**
 * Суммарные токены прогона: каждая запись ответа ассистента несёт `usage` своего запроса,
 * сумма по ним — стоимость всего прогона, включая промежуточные шаги с инструментами.
 * @param {Array<Record<string, any>>} records
 * @returns {{ input: number, cache_read: number, cache_write: number, output: number, reasoning: number }}
 */
export declare function sumUsage(records: Array<Record<string, any>>): {
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
    reasoning: number;
};
/**
 * Сложение двух наборов токенов: несколько прогонов одной стадии (итерации `code`,
 * повтор `review` после доработки) складываются, а не затирают друг друга.
 * @param {{ input: number, cache_read: number, cache_write: number, output: number, reasoning: number, runs: number }} base
 * @param {{ input: number, cache_read: number, cache_write: number, output: number, reasoning: number }} addition
 * @returns {{ input: number, cache_read: number, cache_write: number, output: number, reasoning: number, runs: number }}
 */
export declare function addUsage(base: {
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
    reasoning: number;
    runs: number;
}, addition: {
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
    reasoning: number;
}): {
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
    reasoning: number;
    runs: number;
};
/**
 * Пустой набор токенов стадии.
 * @returns {{ input: number, cache_read: number, cache_write: number, output: number, reasoning: number, runs: number }}
 */
export declare function emptyUsage(): {
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
    reasoning: number;
    runs: number;
};
