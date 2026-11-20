/**
 * Литералы раскладки в коде (ADR [0005](../docs/adr/0005-layout-profile.md), п. «д»).
 *
 * Раскладка — данные: пути приходят из `config.paths`, и ядро не должно знать `.pi/`
 * по имени. Правило «литерал не добавляем» без проверки живёт до первого рефакторинга,
 * поэтому здесь механизм: обойти `scripts/**`, кроме тестов, и найти `.pi/` в строках
 * кода. Комментарии и JSDoc не считаются — там путь уместен как пример раскладки.
 *
 * Список исключений — это **долг с номерами issue**, а не разрешение. Он обязан только
 * сокращаться: файл, в котором литералов больше нет, краснит тест, пока его не уберут из
 * списка. Так «потом починим» не превращается в «забыли».
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

/** Корень репозитория: родитель каталога `scripts/`. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Каталог со скриптами ядра. */
const SCRIPTS = join(ROOT, 'scripts');

/**
 * Файлы, где литерал `.pi/` пока остаётся, с причиной и номером issue. Список сокращается:
 * записи уходят вместе с задачами, которые эти литералы убирают.
 * @type {Record<string, string>}
 */
const DEBT = Object.freeze({
  'scripts/lib/cycle/config.mjs': 'умолчания путей и префикс сообщений об ошибках — #79',
  'scripts/lib/cycle/limits.mjs': 'сообщение о лимите из конфига — #79',
  'scripts/lib/cycle/refs.mjs': 'сообщение о пути в артефактах — #79',
  'scripts/cycle-gates.mjs': 'подсказка «нет секции gates» в конфиге — #79',
  'scripts/harness-init.mjs': 'префикс установки шаблонов и пример конфига — #81',
});

/**
 * Строки кода, где встречается `.pi/`, с номерами строк.
 * @param {string} file
 * @returns {number[]}
 */
function codeLiterals(file) {
  /** @type {number[]} */
  const found = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const [index, line] of lines.entries()) {
    if (!line.includes('.pi/')) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) continue;
    found.push(index + 1);
  }
  return found;
}

/**
 * Все `.mjs` под `scripts/`, кроме тестов.
 * @param {string} dir
 * @param {string[]} [acc]
 * @returns {string[]} пути относительно корня репозитория
 */
function sources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sources(path, acc);
      continue;
    }
    if (!entry.endsWith('.mjs') || entry.endsWith('.test.mjs')) continue;
    acc.push(relative(ROOT, path));
  }
  return acc;
}

describe('раскладка: литералы .pi/ в коде', () => {
  test('литерал есть только там, где он записан долгом с номером issue', () => {
    /** @type {string[]} */
    const unexpected = [];
    for (const file of sources(SCRIPTS)) {
      const literals = codeLiterals(join(ROOT, file));
      if (literals.length === 0) continue;
      if (DEBT[file] !== undefined) continue;
      unexpected.push(`${file}:${literals.join(',')}`);
    }

    assert.deepEqual(
      unexpected,
      [],
      'раскладка — данные (ADR 0005): путь берётся из config.paths, а не пишется литералом',
    );
  });

  test('список долга не гниёт: записи с погашенным литералом убраны', () => {
    const stale = Object.keys(DEBT).filter((file) => codeLiterals(join(ROOT, file)).length === 0);
    assert.deepEqual(stale, [], 'литералов больше нет — уберите файл из списка долга');
  });

  test('у каждой записи долга есть номер issue', () => {
    for (const [file, reason] of Object.entries(DEBT)) {
      assert.match(reason, /#\d+/u, `${file}: причина без номера issue — долг без владельца`);
    }
  });
});
