import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CRITERIA_FILE, CRITERION_LINE, criteriaDigest, parseCriteria } from './criteria.mjs';

describe('parseCriteria', () => {
  test('читает строки `- C1: …` в порядке файла и обрезает пробелы', () => {
    const markdown = ['# Критерии приёмки', '', '- C1: первое', '-  C2:   второе  ', ''].join('\n');

    assert.deepEqual(parseCriteria(markdown), [
      { id: 'C1', text: 'первое' },
      { id: 'C2', text: 'второе' },
    ]);
  });

  test('заголовок и источник в дайджест не входят: они не критерии', () => {
    const markdown = [
      '# Критерии приёмки',
      '',
      'Источник: секция «Критерии приёмки» (feature).',
      '',
      '- C1: x',
    ].join('\n');

    assert.deepEqual(parseCriteria(markdown), [{ id: 'C1', text: 'x' }]);
  });

  test('id вне формы `C<число>` и пункты без номера игнорируются', () => {
    const markdown = [
      '- D1: не критерий',
      '- C0: ноль не допускается',
      '- C1 без двоеточия',
      '- C1: годный',
    ].join('\n');

    assert.deepEqual(parseCriteria(markdown), [{ id: 'C1', text: 'годный' }]);
  });

  test('пустой документ и документ без критериев — пустой набор', () => {
    assert.deepEqual(parseCriteria(''), []);
    assert.deepEqual(parseCriteria('просто текст\n\nбез списка\n'), []);
  });

  test('не строка — TypeError', () => {
    assert.throws(() => parseCriteria(/** @type {any} */ (null)), /ожидается строка/u);
    assert.throws(() => parseCriteria(/** @type {any} */ (42)), /ожидается строка/u);
  });

  test('имена и регулярка экспортируются: файл критериев один на все скрипты', () => {
    assert.equal(CRITERIA_FILE, 'criteria.md');
    assert.equal(CRITERION_LINE.test('- C9: любой текст'), true);
  });
});

/**
 * Критерий в форме `parseCriteria`.
 * @param {string} id
 * @param {string} text
 * @returns {{ id: string, text: string }}
 */
function criterion(id, text) {
  return { id, text };
}

describe('criteriaDigest', () => {
  const criteria = [
    criterion('C1', 'Запрос без serviceId отклоняется'),
    criterion('C2', 'Поведение записи не меняется'),
  ];

  test('детерминирован: одинаковый набор — одинаковый дайджест', () => {
    assert.equal(criteriaDigest(criteria), criteriaDigest(structuredClone(criteria)));
    assert.match(criteriaDigest(criteria), /^[0-9a-f]{64}$/u);
  });

  test('форматирование `criteria.md` не влияет: считается по парам id/текст', () => {
    const plain = ['- C1: Запрос без serviceId отклоняется', '- C2: Поведение записи не меняется'];
    const formatted = [
      '# Критерии приёмки',
      '',
      'Источник: секция «Критерии приёмки» (feature).',
      '',
      ...plain.map((line) => line.replace(': ', ':   ')),
      '',
    ];

    assert.equal(criteriaDigest(parseCriteria(formatted.join('\n'))), criteriaDigest(criteria));
  });

  test('порядок значим: id привязаны к формулировкам', () => {
    const swapped = [
      criterion('C2', 'Поведение записи не меняется'),
      criterion('C1', 'Запрос без serviceId отклоняется'),
    ];

    assert.notEqual(criteriaDigest(criteria), criteriaDigest(swapped));
  });

  test('изменение формулировки — другой дайджест, даже при том же id', () => {
    const changed = [
      criterion('C1', 'Запрос без serviceId принимается'),
      criterion('C2', 'Поведение записи не меняется'),
    ];

    assert.notEqual(criteriaDigest(criteria), criteriaDigest(changed));
  });

  test('не массив — TypeError', () => {
    assert.throws(() => criteriaDigest(/** @type {any} */ ('- C1: x')), /ожидается массив/u);
  });
});
