import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { dedupeUnverified, singleLine } from './unverified.mjs';

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
});
