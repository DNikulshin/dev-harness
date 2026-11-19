/**
 * Читает JSON-файл. Битый JSON и отсутствие файла — исключение: молча возвращать
 * значение по умолчанию нельзя, это скрыло бы повреждённый state цикла.
 * @template T
 * @param {string} file
 * @returns {T}
 */
export declare function readJson<T>(file: string): T;
/**
 * Атомарно пишет текст: `tmp` в каталоге цели → `renameSync`.
 * Если запись падает, целевой файл остаётся прежним, а временный файл удаляется;
 * ошибка пробрасывается вызывающему. Переводы строк не меняются: `diff.patch`
 * и логи гейтов должны попадать в пакет свидетельств байт-в-байт.
 * @param {string} file целевой путь
 * @param {unknown} text содержимое целиком (нестрока — `TypeError`)
 * @returns {void}
 */
export declare function writeTextAtomic(file: string, text: unknown): void;
/**
 * Атомарно пишет данные как JSON: сериализация, затем `writeTextAtomic`.
 * Сериализация идёт до записи, поэтому её сбой не трогает существующий файл.
 * @param {string} file целевой путь
 * @param {unknown} data данные
 * @param {{ serialize?: (data: unknown) => string }} [options]
 *   `serialize` — способ представления (по умолчанию компактный `JSON.stringify`;
 *   для читаемых артефактов вызывающий передаёт сериализатор с отступами)
 * @returns {void}
 */
export declare function writeJsonAtomic(file: string, data: unknown, { serialize }?: {
    serialize?: (data: unknown) => string;
}): void;
/**
 * Хвост файла: последние `lines` строк без завершающего перевода строки.
 * Используется для логов упавших гейтов (страница `evidence/`).
 * @param {string} file
 * @param {number} lines сколько строк оставить (≤ 0 — пустая строка)
 * @returns {string}
 */
export declare function tail(file: string, lines: number): string;
/**
 * Последний блок `json` из markdown-вывода агента. Берём именно последний:
 * агент может сначала привести пример, а итоговый ответ дать ниже.
 * Нет блока или JSON не разбирается — исключение (для `cycle-decide` это сигнал
 * `agent_output_invalid`).
 * @param {string} markdown
 * @returns {unknown}
 */
export declare function extractLastJsonBlock(markdown: string): unknown;
