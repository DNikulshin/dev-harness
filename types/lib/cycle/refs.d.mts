export type ParsedRef = {
    /**
     * вид ссылки
     */
    kind: 'path' | 'gate' | 'qa';
    /**
     * путь (для `path`) или идентификатор (`gate`, `qa`)
     */
    value: string;
    /**
     * номер строки (у диапазона — начало); у `gate:`/`qa:` — `null`
     */
    line: number | null;
    /**
     * конец диапазона; `null` для одиночной строки и `gate:`/`qa:`
     */
    endLine: number | null;
};
export type RefContext = {
    /**
     * корень репозитория: от него считается путь ссылки
     */
    root: string;
    /**
     * разобранный `gates.<n>.json` или `null`, если файла нет
     */
    gates?: unknown;
    /**
     * разобранный `qa-web.json` или `null`, если файла нет
     */
    qa?: unknown;
};
export type RefResolution = {
    /**
     * ссылка разрешилась
     */
    ok: boolean;
    /**
     * исходная строка
     */
    ref: string;
    /**
     * вид ссылки (`null`, если форма не распознана)
     */
    kind: 'path' | 'gate' | 'qa' | null;
    /**
     * нормализованный путь или идентификатор
     */
    value: string | null;
    /**
     * номер строки (у диапазона — начало)
     */
    line: number | null;
    /**
     * конец диапазона (`null`, если ссылка не диапазон)
     */
    endLine: number | null;
    /**
     * абсолютный путь к файлу (только для `path`)
     */
    file: string | null;
    /**
     * причина отказа (только при `ok: false`)
     */
    error: string | null;
};
/**
 * @typedef {object} ParsedRef
 * @property {'path'|'gate'|'qa'} kind вид ссылки
 * @property {string} value путь (для `path`) или идентификатор (`gate`, `qa`)
 * @property {number|null} line номер строки (у диапазона — начало); у `gate:`/`qa:` — `null`
 * @property {number|null} endLine конец диапазона; `null` для одиночной строки и `gate:`/`qa:`
 */
/**
 * @typedef {object} RefContext
 * @property {string} root корень репозитория: от него считается путь ссылки
 * @property {unknown} [gates] разобранный `gates.<n>.json` или `null`, если файла нет
 * @property {unknown} [qa] разобранный `qa-web.json` или `null`, если файла нет
 */
/**
 * @typedef {object} RefResolution
 * @property {boolean} ok ссылка разрешилась
 * @property {string} ref исходная строка
 * @property {'path'|'gate'|'qa'|null} kind вид ссылки (`null`, если форма не распознана)
 * @property {string|null} value нормализованный путь или идентификатор
 * @property {number|null} line номер строки (у диапазона — начало)
 * @property {number|null} endLine конец диапазона (`null`, если ссылка не диапазон)
 * @property {string|null} file абсолютный путь к файлу (только для `path`)
 * @property {string|null} error причина отказа (только при `ok: false`)
 */
/**
 * Разбирает строку ссылки. Ошибка — нераспознанная форма: это не «неразрешённая»
 * ссылка, а некорректный ввод, и вызывающий обычно хочет об этом знать.
 * @param {unknown} ref
 * @returns {ParsedRef}
 */
export declare function parseRef(ref: unknown): ParsedRef;
/**
 * Разрешает ссылку в контексте цикла. Отсутствие `gates`/`qa` в контексте (`null`)
 * означает, что такие ссылки разрешить нельзя: молча считать их верными нельзя,
 * на этом строится счётчик `unresolved_refs` (§5.6).
 * @param {unknown} ref строка `path:line`, `path:start-end`, `gate:<id>` или `qa:<id>`
 * @param {RefContext} ctx
 * @returns {RefResolution}
 */
export declare function resolveRef(ref: unknown, ctx: RefContext): RefResolution;
