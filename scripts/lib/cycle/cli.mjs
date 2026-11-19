/**
 * Определение «модуль запущен как CLI, а не импортирован».
 *
 * Нужно, потому что каждый `scripts/*.mjs` одновременно библиотека (её функции импортируют
 * тесты и другие скрипты) и CLI. Проверка `process.argv[1] === fileURLToPath(import.meta.url)`
 * работала только при прямом запуске файла: `bin` пакета — это символическая ссылка
 * (`node_modules/.bin/harness-cycle-state` → `node_modules/@dnikulshin/harness/scripts/...`),
 * поэтому `argv[1]` содержит путь ссылки, а `import.meta.url` — уже разрешённый путь файла.
 * Строковое сравнение в этом случае ложно, и CLI молча завершался с кодом 0, не выполнив работу.
 *
 * Shebang не нужен: модуль подключается из CLI-скриптов `scripts/*.mjs`.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Запущен ли модуль напрямую (как CLI). Пути сравниваются после разрешения символических
 * ссылок, поэтому работают и `node scripts/<name>.mjs`, и `bin`-обёртка из `node_modules`.
 * Неразрешимый путь (файла нет, `metaUrl` не `file:`) — не прямой запуск, а не исключение:
 * проверка стоит на верхнем уровне модуля и не должна ломать импорт.
 * @param {string} [metaUrl] `import.meta.url` модуля
 * @param {string} [argv1] `process.argv[1]`
 * @returns {boolean}
 */
export function isDirectRun(metaUrl = import.meta.url, argv1 = process.argv[1]) {
  if (typeof metaUrl !== 'string' || typeof argv1 !== 'string' || argv1 === '') return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
