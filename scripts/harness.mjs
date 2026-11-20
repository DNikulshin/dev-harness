#!/usr/bin/env node
/**
 * `harness` — диспетчер пакета: `<команда> [аргументы]`, чтобы `npx @dnikulshin/harness init`
 * работал без знания имён `bin`.
 *
 * Зачем отдельный `bin`. У пакета много точек входа (`harness-init`, `harness-check-layout`,
 * `harness-cycle-*`), и ни одна не называется как пакет. `npx` без установки запускает `bin`,
 * совпадающий с именем пакета (npm берёт последний сегмент имени для scoped-пакетов), поэтому без
 * диспетчера первый запуск требовал бы знать внутреннее имя: `npx --package @dnikulshin/harness
 * harness-init`. Диспетчер убирает это знание из публичного сценария.
 *
 * Логику он не повторяет: команда — это тот же скрипт пакета, запущенный отдельным процессом с
 * наследованием stdio. Одна реализация, один контракт кодов выхода, никакой второй ветки
 * разбора аргументов. Поэтому в списке только то, с чего начинают работу, — установка шаблонов и
 * проверка раскладки; остальные `bin` вызываются своими именами (полный список — в подсказке).
 *
 * Коды выхода: код запущенной команды; `2` — ошибка использования диспетчера (нет команды,
 * неизвестная команда) или невозможность запуска. `--help` печатает подсказку в stdout и даёт `0`.
 *
 * Shebang нужен: файл запускается напрямую.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectRun } from './lib/cycle/cli.mjs';

/** Каталог скриптов пакета: рядом с этим файлом, в том числе внутри `node_modules`. */
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Команды диспетчера: имя → скрипт пакета. Список намеренно короткий: диспетчер не должен
 * превращаться во второй, неполный список CLI.
 * @type {Readonly<Record<string, string>>}
 */
export const COMMANDS = Object.freeze({
  init: 'harness-init.mjs',
  check: 'check-harness.mjs',
});

/**
 * Подсказка по использованию.
 * @returns {string}
 */
export function usage() {
  return [
    'использование: harness <команда> [аргументы]',
    '',
    'команды:',
    '  init   установить шаблоны harness в проект и проверить раскладку (harness-init)',
    '  check  проверить раскладку проекта (harness-check-layout)',
    '',
    'остальные команды вызываются своими именами: harness-cycle-state, harness-cycle-gates,',
    'harness-cycle-evidence, harness-cycle-decide, harness-cycle-metrics, harness-cycle-report,',
    'harness-cycle-pr-body, harness-cycle-usage, harness-cycle-driver, harness-evals-collect,',
    'harness-evals-cost, harness-evals-pack, harness-evals-score, harness-selftest',
  ].join('\n');
}

/**
 * Разбор команды: первый аргумент — имя, остальные уходят команде без изменений.
 * @param {string[]} argv аргументы после `harness`
 * @returns {{ script: string|null, rest: string[] }} `script === null` — подсказка без команды
 */
export function resolveCommand(argv) {
  const [command, ...rest] = argv;
  if (command === undefined) return { script: null, rest };
  const script = COMMANDS[command];
  if (script === undefined) {
    throw new Error(
      `неизвестная команда: ${command} (ожидается ${Object.keys(COMMANDS).join(' | ')})`,
    );
  }
  return { script, rest };
}

/**
 * Точка входа CLI.
 * @param {string[]} [argv]
 * @returns {number} код выхода
 */
export function main(argv = process.argv.slice(2)) {
  const [command] = argv;
  if (command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  /** @type {string} */
  let script;
  /** @type {string[]} */
  let rest;
  try {
    const resolved = resolveCommand(argv);
    if (resolved.script === null) {
      process.stderr.write(`${usage()}\n`);
      return 2;
    }
    script = resolved.script;
    rest = resolved.rest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`harness: ${message}\n`);
    return 2;
  }

  const result = spawnSync(process.execPath, [join(SCRIPTS_DIR, script), ...rest], {
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`harness: ${result.error.message}\n`);
    return 2;
  }
  return result.status ?? 2;
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) process.exitCode = main();
