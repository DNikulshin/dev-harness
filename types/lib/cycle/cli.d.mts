/**
 * Запущен ли модуль напрямую (как CLI). Пути сравниваются после разрешения символических
 * ссылок, поэтому работают и `node scripts/<name>.mjs`, и `bin`-обёртка из `node_modules`.
 * Неразрешимый путь (файла нет, `metaUrl` не `file:`) — не прямой запуск, а не исключение:
 * проверка стоит на верхнем уровне модуля и не должна ломать импорт.
 * @param {string} [metaUrl] `import.meta.url` модуля
 * @param {string} [argv1] `process.argv[1]`
 * @returns {boolean}
 */
export declare function isDirectRun(metaUrl?: string, argv1?: string): boolean;
