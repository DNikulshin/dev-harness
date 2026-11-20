/**
 * Проверка архива перед публикацией (issue #72).
 *
 * Зачем. `npm publish` необратим: версию нельзя перезаписать, ошибку в составе архива
 * потребитель видит первым. Поэтому релизный workflow публикует **не репозиторий, а собранный
 * `pnpm pack` архив**, и между сборкой и публикацией стоит эта проверка: состав (`files`), файлы,
 * обещанные `bin`/`exports`, совпадение версии с тегом. Находки печатаются списком, код выхода
 * `1` останавливает workflow до публикации.
 *
 * Правила — общие с тестом потребителя (`scripts/lib/package-contract.mjs`): здесь только
 * обвязка «прочитать архив → спросить правила → отчитаться». Сама проверка файлов не меняет.
 *
 * Инфраструктура репозитория, а не часть пакета (ADR 0003): потребителю не поставляется.
 *
 * Использование:
 * ```
 * node tooling/check-package.mjs <архив.tgz> [--tag vX.Y.Z]
 * ```
 * `--tag` сверяет версию в `package.json` архива с тегом (`v` отбрасывается): тег — контракт
 * потребителя, и расхождение с `package.json` означало бы «по тегу ставится другой код».
 *
 * Коды выхода: `0` — архив прошёл проверку; `1` — есть находки; `2` — ошибка использования или
 * чтения архива.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { isDirectRun } from '../scripts/lib/cycle/cli.mjs';
import {
  archiveProblems,
  packageProblems,
  REQUIRED_ENTRIES,
} from '../scripts/lib/package-contract.mjs';

/**
 * Имена файлов архива без ведущего `package/`.
 * @param {string} file
 * @returns {string[]}
 */
export function archiveEntries(file) {
  const listing = execFileSync('tar', ['-tzf', file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== 'package/')
    .map((line) => line.replace(/^package\//u, ''));
}

/**
 * `package.json` из архива — то, что получит потребитель.
 * @param {string} file
 * @returns {Record<string, any>}
 */
export function archivePackage(file) {
  const text = execFileSync('tar', ['-xOzf', file, 'package/package.json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(text);
}

/**
 * Все находки по архиву: состав и обещания `package.json`.
 * @param {object} options
 * @param {string} options.file путь к архиву
 * @param {string|null} [options.tag] тег релиза (`vX.Y.Z`); `null` — без сверки версии
 * @returns {string[]}
 */
export function checkArchive({ file, tag = null }) {
  if (!existsSync(file)) throw new Error(`архив не найден: ${file}`);

  const entries = archiveEntries(file);
  const pkg = archivePackage(file);
  const expected = tag === null ? {} : { version: tag.replace(/^v/u, '') };

  return [...archiveProblems(entries), ...packageProblems({ pkg, entries, expected })];
}

/**
 * Разбор аргументов: архив и необязательный тег.
 * @param {string[]} argv
 * @returns {{ file: string, tag: string|null }}
 */
export function parseArgs(argv) {
  /** @type {string|null} */
  let file = null;
  /** @type {string|null} */
  let tag = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tag') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--tag: ожидается vX.Y.Z');
      }
      tag = value;
      index += 1;
      continue;
    }
    if (arg === undefined || arg.startsWith('--')) {
      throw new Error(`неизвестный аргумент: ${arg ?? ''}`);
    }
    if (file !== null) throw new Error(`лишний аргумент: ${arg}`);
    file = resolve(arg);
  }

  if (file === null) {
    throw new Error('использование: check-package <архив.tgz> [--tag vX.Y.Z]');
  }
  return { file, tag };
}

/**
 * CLI.
 * @param {string[]} argv
 * @returns {number} код выхода
 */
function main(argv) {
  /** @type {{ file: string, tag: string|null }} */
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`check-package: ${error instanceof Error ? error.message : error}\n`);
    return 2;
  }

  /** @type {string[]} */
  let problems;
  try {
    problems = checkArchive(args);
  } catch (error) {
    process.stderr.write(`check-package: ${error instanceof Error ? error.message : error}\n`);
    return 2;
  }

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`check-package: ${problem}\n`);
    process.stderr.write(
      `check-package: архив не готов к публикации — правьте files/package.json (обязательных записей ${REQUIRED_ENTRIES.length})\n`,
    );
    return 1;
  }

  process.stdout.write(
    `check-package: ${args.file} — состав в порядке (${REQUIRED_ENTRIES.length} записей контракта)\n`,
  );
  return 0;
}

if (isDirectRun(import.meta.url)) process.exitCode = main(process.argv.slice(2));
