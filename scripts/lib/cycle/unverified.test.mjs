import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  UNVERIFIED_SOURCES,
  dedupeUnverified,
  singleLine,
  unverifiedSource,
} from './unverified.mjs';

describe('unverified', () => {
  test('префикс источника снимается: один факт не считается дважды', () => {
    const items = dedupeUnverified([
      'gate:test_int not_run (no_database)',
      'evaluation unverified: Поведение на битом JSON',
      'Поведение на битом JSON',
    ]);

    assert.equal(items.length, 2, 'два факта, а не три');
    assert.ok(
      items.includes('evaluation unverified: Поведение на битом JSON'),
      'осталась более полная формулировка (длиннее — значит больше контекста)',
    );
    assert.equal(items[0], 'gate:test_int not_run (no_database)', 'порядок — первого вхождения');
  });

  test('регистр и пробелы не различают пункты: остаётся первая формулировка', () => {
    assert.deepEqual(dedupeUnverified(['Нет   фикстуры\nс обрезкой', 'нет фикстуры с обрезкой']), [
      'Нет фикстуры с обрезкой',
    ]);
  });

  test('более полная формулировка заменяет короткую на её позиции', () => {
    assert.deepEqual(dedupeUnverified(['Один факт', 'Другой', 'один факт — с пояснением']), [
      'один факт — с пояснением',
      'Другой',
    ]);
  });

  test('короткая версия не в начале длинной — это разные факты', () => {
    assert.deepEqual(dedupeUnverified(['тест', 'тесты интеграции']), ['тест', 'тесты интеграции']);
  });

  test('пустые строки и не-строки пропускаются, не-массив — ошибка типа', () => {
    assert.deepEqual(dedupeUnverified(['  ', '\n', 'пункт']), ['пункт']);
    assert.throws(() => dedupeUnverified(/** @type {any} */ (null)), TypeError);
    assert.throws(() => dedupeUnverified(/** @type {any} */ ('пункт')), TypeError);
  });

  test('префикс `unproven:` снимается: понижение одного факта не удваивается (#125)', () => {
    const items = dedupeUnverified([
      'unproven: R1 [BLOCKER] ссылка не разрешается',
      'R1 [BLOCKER] ссылка не разрешается',
    ]);

    assert.deepEqual(items, ['unproven: R1 [BLOCKER] ссылка не разрешается']);
  });

  test('`unproven:` и `evaluation unverified:` — разные факты при разном тексте', () => {
    const items = dedupeUnverified([
      'unproven: C1 [partial]',
      'evaluation unverified: Поведение на битом JSON',
    ]);

    assert.equal(items.length, 2);
  });

  test('singleLine: пробельные последовательности — один пробел', () => {
    assert.equal(singleLine('  a\n\tb  '), 'a b');
  });

  test('unverifiedSource: префикс строки решает, откуда пришёл пункт (#137)', () => {
    assert.equal(unverifiedSource('gate:test_int not_run (no_database)'), 'gate');
    assert.equal(unverifiedSource('gate:test_int not_run'), 'gate');
    assert.equal(unverifiedSource('unproven: R1 [BLOCKER] ссылка не разрешается'), 'unproven');
    assert.equal(unverifiedSource('unproven: C1 [partial]'), 'unproven');
    assert.equal(unverifiedSource('criteria:C3 missing'), 'criteria_missing');
  });

  test('unverifiedSource: остальное — `other`, а не догадка о причине', () => {
    assert.equal(unverifiedSource('criteria:C3 unverified'), 'other');
    assert.equal(unverifiedSource('evaluation unverified: Битая запись'), 'other');
    assert.equal(unverifiedSource('qa-web not_run (web-diff)'), 'other');
    assert.equal(unverifiedSource('integrity: tests deleted src/old.test.mjs'), 'other');
    assert.equal(unverifiedSource('gate:test_int not_run'), 'gate', 'причина в скобках не мешает');
  });

  test('unverifiedSource: список источников и разбор не расходятся', () => {
    const samples = [
      'gate:a not_run',
      'unproven: X [MAJOR] нет ссылки',
      'criteria:C1 missing',
      'integrity: tests changed (2)',
    ];

    assert.deepEqual(samples.map(unverifiedSource), [...UNVERIFIED_SOURCES]);
  });
});
