/**
 * Тесты `tooling/rag-sync.mjs` (issue #169).
 *
 * Синк запускает `npx mcp-local-rag`, поэтому проверяется не он, а то, что перед ним: список
 * исключений (без `.pi/artifacts/` полная сверка возвращает в общую базу артефакты циклов всех
 * проектов) и условие запуска `main()`. Раньше `main()` вызывался на импорте, и модуль нельзя было
 * прочитать из теста без побочного эффекта.
 */
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';

import { IGNORE_PATTERNS, isEntryPoint } from './rag-sync.mjs';

describe('IGNORE_PATTERNS: что не попадает в общую базу', () => {
  test('артефакты циклов исключены — иначе полная сверка вернёт их в индекс', () => {
    assert.ok(
      IGNORE_PATTERNS.includes('**/.pi/artifacts/**'),
      'без **/.pi/artifacts/** синк без явного пути проиндексирует .pi/artifacts/ всех проектов',
    );
  });

  test('секреты исключены', () => {
    assert.ok(
      IGNORE_PATTERNS.includes('**/.env*'),
      'без **/.env* полная сверка отправит .env* в RAG',
    );
  });

  test('рабочая обвязка и сборка исключены', () => {
    for (const pattern of ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/.next/**']) {
      assert.ok(IGNORE_PATTERNS.includes(pattern), `нет исключения ${pattern}`);
    }
  });

  test('список не содержит пустых строк: пустой шаблон исключил бы всё', () => {
    assert.ok(IGNORE_PATTERNS.every((pattern) => pattern.trim() !== ''));
  });
});

describe('isEntryPoint: main() только при прямом запуске', () => {
  const SELF = fileURLToPath(new URL('./rag-sync.mjs', import.meta.url));
  const MODULE_URL = pathToFileURL(SELF).href;

  test('прямой запуск файла — true', () => {
    assert.equal(isEntryPoint(SELF, MODULE_URL), true);
  });

  test('импорт из другого модуля — false', () => {
    const other = fileURLToPath(new URL('./rag-sync.test.mjs', import.meta.url));

    assert.equal(isEntryPoint(other, MODULE_URL), false);
  });

  test('argv[1] отсутствует (node --test, REPL) — false, а не падение', () => {
    assert.equal(isEntryPoint(undefined, MODULE_URL), false);
    assert.equal(isEntryPoint('', MODULE_URL), false);
  });
});
