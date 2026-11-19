import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';

import { findTestFiles, runTests } from './selftest.mjs';

/**
 * Временный каталог со структурой тестов.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function makeTree(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-selftest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'b.test.mjs'), '');
  writeFileSync(join(dir, 'plain.mjs'), '');
  mkdirSync(join(dir, 'lib'));
  writeFileSync(join(dir, 'lib', 'a.test.mjs'), '');
  mkdirSync(join(dir, 'fixtures'));
  writeFileSync(join(dir, 'fixtures', 'data.test.mjs'), '');
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'node_modules', 'dep.test.mjs'), '');
  return dir;
}

describe('findTestFiles', () => {
  test('находит тесты рекурсивно и пропускает fixtures и node_modules', (t) => {
    const dir = makeTree(t);
    const found = findTestFiles(dir).map((path) => relative(dir, path));

    // Порядок обхода: имена сортируются на каждом уровне, подкаталоги обходятся на месте.
    assert.deepEqual(found, ['b.test.mjs', join('lib', 'a.test.mjs')]);
  });

  test('в репозитории тестов ядра больше одного файла', () => {
    assert.ok(findTestFiles(new URL('..', import.meta.url).pathname).length > 1);
  });
});

describe('runTests', () => {
  test('прошедшие файлы не попадают в список упавших', (t) => {
    const dir = makeTree(t);
    const file = join(dir, 'ok.test.mjs');
    writeFileSync(file, 'import{test}from"node:test";test("ок",()=>{});\n');

    const { failed } = runTests([file], { stdio: 'pipe' });
    assert.deepEqual(failed, []);
  });

  test('упавший файл попадает в список упавших', (t) => {
    const dir = makeTree(t);
    const file = join(dir, 'bad.test.mjs');
    writeFileSync(
      file,
      'import assert from"node:assert/strict";import{test}from"node:test";test("плохо",()=>assert.fail("нет"));\n',
    );

    const { failed } = runTests([file], { stdio: 'pipe' });
    assert.deepEqual(failed, [file]);
  });
});

describe('CLI', () => {
  test('неизвестный аргумент — код 2', () => {
    const cli = new URL('./selftest.mjs', import.meta.url).pathname;
    const result = spawnSync(process.execPath, [cli, '--wrong'], { encoding: 'utf8' });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /неизвестный аргумент/u);
  });
});
