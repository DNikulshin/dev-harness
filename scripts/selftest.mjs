#!/usr/bin/env node
/**
 * Самотест установленного пакета: прогон тестов ядра из `node_modules`.
 *
 * Зачем отдельная команда, а не `node --test node_modules/@dnikulshin/harness/scripts`:
 * встроенный раннер Node исключает пути, содержащие `node_modules`, и с явным файлом
 * внутри него сообщает `Could not find`, то есть тесты установленного пакета им не
 * запускаются вообще. Поэтому тестовые файлы запускаются по одному как обычные модули:
 * `node:test` в таком режиме сам считает файл набором тестов и отдаёт корректный код выхода.
 *
 * Что считается тестом: `*.test.mjs` в `scripts/` и `scripts/lib/**`; каталог
 * `scripts/fixtures/` — данные тестов, а не тесты, и не обходится.
 *
 * Коды выхода: `0` — все файлы прошли; `1` — хотя бы один файл упал (или упал запуск);
 * `2` — ошибка использования (лишние аргументы, тестов не нашлось).
 * Shebang нужен: файл запускается напрямую.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectRun } from './lib/cycle/cli.mjs';

/** Каталог со скриптами ядра: рядом с этим файлом, в том числе внутри `node_modules`. */
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Каталоги, которые не обходятся: данные тестов, а не сами тесты. */
const SKIP_DIRS = Object.freeze(['fixtures']);

const TEST_FILE = /\.test\.mjs$/u;

/**
 * Рекурсивно собирает тестовые файлы.
 * @param {string} dir каталог обхода
 * @returns {string[]} абсолютные пути в стабильном порядке
 */
export function findTestFiles(dir) {
  /** @type {string[]} */
  const found = [];

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.includes(entry.name) || entry.name === 'node_modules') continue;
      found.push(...findTestFiles(path));
      continue;
    }
    if (entry.isFile() && TEST_FILE.test(entry.name)) found.push(path);
  }

  return found;
}

/**
 * Запускает тестовые файлы по одному и печатает сводку.
 * @param {string[]} files абсолютные пути тестовых файлов
 * @param {{ execPath?: string, stdio?: 'inherit' | 'pipe' }} [options]
 * @returns {{ failed: string[] }}
 */
export function runTests(files, { execPath = process.execPath, stdio = 'inherit' } = {}) {
  /** @type {string[]} */
  const failed = [];

  for (const file of files) {
    process.stdout.write(`\n== ${relative(SCRIPTS_DIR, file)}\n`);
    const result = spawnSync(execPath, [file], { stdio });
    if (result.status !== 0) failed.push(file);
  }

  return { failed };
}

/**
 * CLI: без аргументов прогоняет все тесты пакета.
 * @param {string[]} argv
 * @returns {number} код выхода
 */
function main(argv) {
  if (argv.length > 0) {
    process.stderr.write(`harness-selftest: неизвестный аргумент: ${argv[0]}\n`);
    return 2;
  }

  const files = findTestFiles(SCRIPTS_DIR);
  if (files.length === 0) {
    process.stderr.write(`harness-selftest: тестовые файлы не найдены в ${SCRIPTS_DIR}\n`);
    return 2;
  }

  const { failed } = runTests(files);
  process.stdout.write(`\nфайлов: ${files.length}, упало: ${failed.length}\n`);
  return failed.length === 0 ? 0 : 1;
}

// Модуль импортируется тестами ради `findTestFiles`; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) process.exitCode = main(process.argv.slice(2));
