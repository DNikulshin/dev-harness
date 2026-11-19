import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { classifyIntegrity, integrityConfigured, matchesPath } from './integrity.mjs';

/** Правила по умолчанию: секция задана, но пуста. */
const NO_RULES = Object.freeze({ testPaths: [], protectedPaths: [] });

describe('matchesPath: правила путей', () => {
  test('точный путь совпадает сам, префикс по символам не режется', () => {
    assert.equal(matchesPath('.pi/harness.config.json', '.pi/harness.config.json'), true);
    assert.equal(matchesPath('.pi/harness.config.json', '.pi/harness.config.json.bak'), false);
    // Правило задевает путь и всё вложенное (у файла вложенных путей не бывает — безвредно).
    assert.equal(matchesPath('.pi/harness.config.json', '.pi/harness.config.json/x'), true);
  });

  test('правило-каталог задевает вложенные файлы (как префикс)', () => {
    assert.equal(matchesPath('tests', 'tests/unit/a.test.mjs'), true);
    assert.equal(matchesPath('tests', 'tests'), true);
    assert.equal(matchesPath('tests', 'tests-old/a.test.mjs'), false);
    assert.equal(matchesPath('.pi/agents', '.pi/agents/review.md'), true);
  });

  test('`*` не пересекает границу сегмента', () => {
    assert.equal(matchesPath('scripts/*.test.mjs', 'scripts/cycle-decide.test.mjs'), true);
    assert.equal(matchesPath('scripts/*.test.mjs', 'scripts/lib/cycle/config.test.mjs'), false);
    assert.equal(matchesPath('apps/*/test', 'apps/api/test'), true);
    assert.equal(matchesPath('apps/*/test', 'apps/api/test/unit'), true);
  });

  test('`**` раскрывается в ноль и больше сегментов', () => {
    assert.equal(matchesPath('**/*.test.mjs', 'a.test.mjs'), true);
    assert.equal(matchesPath('**/*.test.mjs', 'scripts/lib/cycle/config.test.mjs'), true);
    assert.equal(matchesPath('scripts/**/config.test.mjs', 'scripts/config.test.mjs'), true);
    assert.equal(
      matchesPath('scripts/**/config.test.mjs', 'scripts/lib/cycle/config.test.mjs'),
      true,
    );
    assert.equal(matchesPath('**', 'anything/at/all.txt'), true);
  });

  test('чужая ветка каталога не совпадает', () => {
    assert.equal(matchesPath('scripts/lib/cycle', 'scripts/lib/cycles/x.mjs'), false);
    assert.equal(matchesPath('src/**/*.ts', 'src2/a.ts'), false);
  });

  test('пустое правило не совпадает ни с чем', () => {
    assert.equal(matchesPath('', 'files/anything'), false);
    assert.equal(matchesPath('/', 'files/anything'), false);
  });

  test('путь на границе символа не режется (нет ложных префиксов)', () => {
    assert.equal(matchesPath('test', 'testx/a.mjs'), false);
    assert.equal(matchesPath('test/**', 'testx/a.mjs'), false);
  });
});

describe('classifyIntegrity: правила проекта против диффа', () => {
  const rules = {
    testPaths: ['**/*.test.mjs', 'tests'],
    protectedPaths: ['.pi/harness.config.json', '.pi/agents'],
  };

  test('чистый дифф — пустые списки при заданных правилах', () => {
    const doc = classifyIntegrity({
      changes: [{ path: 'src/index.mjs', status: 'modified' }],
      integrity: rules,
    });

    assert.deepEqual(doc.tests, { added: [], modified: [], deleted: [] });
    assert.deepEqual(doc.protected, { added: [], modified: [], deleted: [] });
    assert.deepEqual(doc.test_paths, rules.testPaths);
    assert.deepEqual(doc.protected_paths, rules.protectedPaths);
  });

  test('правка теста и конфига гейтов попадают в артефакт', () => {
    const doc = classifyIntegrity({
      changes: [
        { path: '.pi/harness.config.json', status: 'modified' },
        { path: 'scripts/lib/cycle/config.test.mjs', status: 'modified' },
      ],
      integrity: rules,
    });

    assert.deepEqual(doc.tests.modified, ['scripts/lib/cycle/config.test.mjs']);
    assert.deepEqual(doc.protected.modified, ['.pi/harness.config.json']);
  });

  test('удалённый и добавленный тест — разные статусы', () => {
    const doc = classifyIntegrity({
      changes: [
        { path: 'scripts/old.test.mjs', status: 'deleted' },
        { path: 'scripts/new.test.mjs', status: 'added' },
      ],
      integrity: rules,
    });

    assert.deepEqual(doc.tests.deleted, ['scripts/old.test.mjs']);
    assert.deepEqual(doc.tests.added, ['scripts/new.test.mjs']);
    assert.deepEqual(doc.tests.modified, []);
  });

  test('порядок не зависит от порядка вывода git', () => {
    /** @type {import('./integrity.mjs').FileChange[]} */
    const changes = [
      { path: 'scripts/b.test.mjs', status: 'modified' },
      { path: 'scripts/a.test.mjs', status: 'modified' },
    ];
    const straight = classifyIntegrity({ changes, integrity: rules });
    const reversed = classifyIntegrity({ changes: [...changes].reverse(), integrity: rules });

    assert.deepEqual(straight, reversed);
    assert.deepEqual(straight.tests.modified, ['scripts/a.test.mjs', 'scripts/b.test.mjs']);
  });

  test('файл под двумя линзами попадает в обе группы', () => {
    const doc = classifyIntegrity({
      changes: [{ path: 'tests/harness.config.json', status: 'modified' }],
      integrity: { testPaths: ['tests'], protectedPaths: ['tests/harness.config.json'] },
    });

    assert.deepEqual(doc.tests.modified, ['tests/harness.config.json']);
    assert.deepEqual(doc.protected.modified, ['tests/harness.config.json']);
  });

  test('без правил классификация пустая, но форма артефакта та же', () => {
    const doc = classifyIntegrity({
      changes: [{ path: 'tests/a.test.mjs', status: 'modified' }],
      integrity: NO_RULES,
    });

    assert.deepEqual(doc, {
      test_paths: [],
      protected_paths: [],
      tests: { added: [], modified: [], deleted: [] },
      protected: { added: [], modified: [], deleted: [] },
    });
  });

  test('неизвестный статус — ошибка, а не молчаливая потеря файла', () => {
    assert.throws(
      () =>
        classifyIntegrity({
          changes: /** @type {any} */ ([{ path: 'a.test.mjs', status: 'renamed' }]),
          integrity: rules,
        }),
      TypeError,
    );
  });
});

describe('integrityConfigured: когда артефакт вообще нужен', () => {
  test('пустые правила и отсутствие секции — не настроено', () => {
    assert.equal(integrityConfigured(null), false);
    assert.equal(integrityConfigured(undefined), false);
    assert.equal(integrityConfigured(NO_RULES), false);
  });

  test('хотя бы одно правило — настроено', () => {
    assert.equal(integrityConfigured({ testPaths: ['tests'], protectedPaths: [] }), true);
    assert.equal(integrityConfigured({ testPaths: [], protectedPaths: ['AGENTS.md'] }), true);
  });
});
