/**
 * Ссылки на issues, которых нет (решение «а» по задаче #129).
 *
 * Номер issue в JSDoc — обещание «почему так решено» лежит в трекере. Если номера нет,
 * обещание ложное: читатель идёт по ссылке и не находит ничего, а код выглядит объяснённым.
 * Поэтому такие номера сняты, а обоснование осталось формулировкой правила рядом.
 *
 * Проверка без сети — единственный честный вариант: «номер должен существовать» требует `gh`
 * и в тестах не годится. Здесь снимок мёртвых номеров на дату `SNAPSHOT_DATE` (максимальный
 * номер issue/PR в трекере на тот момент — `MAX_REF_AT_SNAPSHOT`). Снимок пополняется вручную,
 * когда мёртвый номер находится; рост нумерации его не старит, потому что новых живых номеров
 * в снимке нет.
 *
 * Hex-safe: `#6b7280` и подобные не считаются ссылкой — паттерн требует границу слова после
 * цифр, а буква в hex-литерале её не даёт. Cross-repo ссылки `owner/repo#N` относятся к чужому
 * трекеру и не проверяются: они валидны и по смыслу, и грамматически.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

/** Корень репозитория: родитель каталога `scripts/`. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Дата снимка мёртвых номеров. */
const SNAPSHOT_DATE = '2026-11-21';

/**
 * Максимальный номер issue/PR в трекере на дату снимка. Номера больше него на момент снимка
 * не существуют; снимок ниже перечисляет те из них, что встречались в репозитории.
 */
const MAX_REF_AT_SNAPSHOT = 142;

/**
 * Номера, которых нет в трекере ни как issue, ни как PR. Записи появляются только ручной
 * проверкой `gh` и только на дату снимка — автоматически список не пополняется.
 * @type {readonly number[]}
 */
const DEAD_REFS = Object.freeze([
  153, 154, 155, 156, 157, 158, 160, 167, 178, 196, 200, 202, 203, 204, 205, 207, 208, 216, 219,
  224, 233, 235, 247, 274,
]);

/**
 * Голый номер issue: решётка и цифры (пример — `#N`), но не `owner/repo#N` и не часть
 * hex-литерала.
 * @type {RegExp}
 */
const BARE_REF = /(?<![\w/])#(\d+)\b/g;

/** Каталоги, в которых ссылки проверяются: код ядра и норматив. */
const SCOPES = Object.freeze([
  { dir: 'scripts', ext: '.mjs' },
  { dir: 'docs', ext: '.md' },
]);

/**
 * Файлы заданного расширения под каталогом, рекурсивно.
 * @param {string} dir абсолютный путь
 * @param {string} ext
 * @param {string[]} [acc] абсолютные пути
 * @returns {string[]}
 */
function files(dir, ext, acc = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files(path, ext, acc);
      continue;
    }
    if (entry.endsWith(ext)) acc.push(path);
  }
  return acc;
}

/**
 * Мёртвые номера в одном файле, с номерами строк.
 * @param {string} file абсолютный путь
 * @returns {string[]} строки вида `путь:строка: #номер`
 */
function deadRefs(file) {
  const dead = new Set(DEAD_REFS);
  /** @type {string[]} */
  const found = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(BARE_REF)) {
      const ref = Number(match[1]);
      if (!dead.has(ref)) continue;
      found.push(`${relative(ROOT, file)}:${index + 1}: #${ref}`);
    }
  }
  return found;
}

describe('ссылки на issues: мёртвые номера', () => {
  test('снимок датирован и не выходит за максимальный номер трекера', () => {
    assert.match(SNAPSHOT_DATE, /^\d{4}-\d{2}-\d{2}$/);
    for (const ref of DEAD_REFS) {
      assert.ok(Number.isInteger(ref) && ref > 0, `номер должен быть целым: ${ref}`);
      assert.ok(
        ref > MAX_REF_AT_SNAPSHOT,
        `#${ref} не может быть мёртвым на дату снимка: номер не больше ${MAX_REF_AT_SNAPSHOT}`,
      );
    }
    assert.equal(new Set(DEAD_REFS).size, DEAD_REFS.length, 'в снимке нет дублей');
  });

  test('в scripts/ и docs/ нет ссылок на мёртвые номера', () => {
    /** @type {string[]} */
    const violations = [];
    for (const { dir, ext } of SCOPES) {
      for (const file of files(join(ROOT, dir), ext)) violations.push(...deadRefs(file));
    }
    assert.deepEqual(
      violations,
      [],
      `номера сняты по решению «а» (#129): обоснование остаётся формулировкой правила.\n${violations.join('\n')}`,
    );
  });
});
