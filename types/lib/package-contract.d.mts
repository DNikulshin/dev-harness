/**
 * Что обязано быть в архиве, чтобы потребитель заработал: лицензия и доки, скрипты и данные
 * самотеста, типы потребителя, шаблоны установки, норматив.
 * @type {readonly string[]}
 */
export declare const REQUIRED_ENTRIES: readonly string[];
/**
 * Чего в архиве быть не должно: локальные артефакты и инфраструктура репозитория.
 * @type {readonly string[]}
 */
export declare const FORBIDDEN_ENTRIES: readonly string[];
/**
 * Пути, которые `exports`/`bin` обещают потребителю: без них установка формально успешна, а
 * импорт и `node_modules/.bin` падают у него, а не в CI.
 * @param {Record<string, unknown>} pkg разобранный `package.json`
 * @returns {string[]} пути внутри пакета (`./` срезан)
 */
export declare function promisedPaths(pkg: Record<string, unknown>): string[];
/**
 * Находки по составу архива.
 * @param {Iterable<string>} entries имена файлов архива без ведущего `package/`
 * @returns {string[]} проблемы; пустой список — архив полон
 */
export declare function archiveProblems(entries: Iterable<string>): string[];
/**
 * Находки по обещаниям `package.json` архива: имя, версия, наличие файлов `bin`/`exports`.
 * @param {object} options
 * @param {Record<string, unknown>} options.pkg `package.json` из архива
 * @param {Iterable<string>} options.entries имена файлов архива без ведущего `package/`
 * @param {{ name?: string, version?: string }} [options.expected] ожидаемые имя и версия
 * @returns {string[]} проблемы; пустой список — обещания выполнены
 */
export declare function packageProblems({ pkg, entries, expected }: {
    pkg: Record<string, unknown>;
    entries: Iterable<string>;
    expected?: {
        name?: string;
        version?: string;
    };
}): string[];
