import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { isDirectRun } from './cli.mjs';

/**
 * Временный каталог с файлом-модулем и символической ссылкой на него: так же выглядит
 * `bin` пакета внутри `node_modules/.bin`.
 * @param {import('node:test').TestContext} t
 * @returns {{ dir: string, file: string, link: string }}
 */
function makeLinkedScript(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const file = join(dir, 'script.mjs');
  writeFileSync(file, '#!/usr/bin/env node\n');
  const link = join(dir, 'harness-script');
  symlinkSync(file, link);
  return { dir, file, link };
}

describe('isDirectRun', () => {
  test('прямой запуск файла — истина', (t) => {
    const { file } = makeLinkedScript(t);
    assert.equal(isDirectRun(pathToFileURL(file).href, file), true);
  });

  test('запуск через символическую ссылку (bin) — истина, как и у реального пути', (t) => {
    const { file, link } = makeLinkedScript(t);
    assert.equal(isDirectRun(pathToFileURL(file).href, link), true);
  });

  test('импорт из чужого процесса (argv[1] — другой файл) — ложь', (t) => {
    const { dir, file } = makeLinkedScript(t);
    assert.equal(isDirectRun(pathToFileURL(file).href, join(dir, 'other.mjs')), false);
  });

  test('отсутствие argv[1] или пустая строка — ложь', (t) => {
    const { file } = makeLinkedScript(t);
    const url = pathToFileURL(file).href;
    assert.equal(isDirectRun(url, undefined), false);
    assert.equal(isDirectRun(url, ''), false);
  });

  test('неразрешимые пути не бросают исключение', () => {
    assert.equal(isDirectRun('node:fs', 'node:fs'), false);
    assert.equal(isDirectRun('file:///нет/такого/файла.mjs', '/нет/такого/файла.mjs'), false);
  });
});
