/**
 * Тесты `tooling/pr-reference.mjs`.
 *
 * Проверяется главное свойство: подсказка шаблона и примеры в блоках кода ссылкой не считаются,
 * а настоящая строка `Closes #N` — считается. Ошибка в любую сторону дорога: ложное «есть»
 * оставит issue открытым после мержа, ложное «нет» заблокирует нормальный PR.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { closingIssues, main, missingReferenceReason, strippedBody } from './pr-reference.mjs';

describe('closingIssues: что считается ссылкой', () => {
  test('основные формы ключевых слов', () => {
    assert.deepEqual(closingIssues('Closes #12'), [12]);
    assert.deepEqual(closingIssues('closes #12'), [12]);
    assert.deepEqual(closingIssues('CLOSES #12'), [12]);
    assert.deepEqual(closingIssues('Closes: #12'), [12]);
    assert.deepEqual(closingIssues('closes:#12'), [12]);
    assert.deepEqual(closingIssues('Fixes #7'), [7]);
    assert.deepEqual(closingIssues('resolves #3'), [3]);
  });

  test('несколько ссылок — все, без повторов и в порядке появления', () => {
    assert.deepEqual(closingIssues('Closes #9\nFixes #2\nCloses #9'), [9, 2]);
  });

  test('ссылка в середине текста и в списке', () => {
    const body = ['## Что сделано', '', '- сделано по задаче', '', 'Closes #42', ''].join('\n');
    assert.deepEqual(closingIssues(body), [42]);
  });

  test('подсказка шаблона без номера ссылкой не считается', () => {
    const template = [
      '## Что сделано',
      '<!-- 1–3 пункта. Ссылка на issue: Closes #<номер> -->',
      '',
      'Closes #',
    ].join('\n');
    assert.deepEqual(closingIssues(template), []);
  });

  test('пример в HTML-комментарии не засчитывается', () => {
    assert.deepEqual(closingIssues('<!-- пример: Closes #12 -->\nничего не закрываем'), []);
  });

  test('пример в блоке кода не засчитывается', () => {
    const body = ['Как оформить:', '', '```', 'Closes #12', '```', ''].join('\n');
    assert.deepEqual(closingIssues(body), []);
  });

  test('ссылка вне блока кода при наличии примеров внутри — засчитывается', () => {
    const body = ['```', 'Closes #1', '```', '', 'Closes #2', ''].join('\n');
    assert.deepEqual(closingIssues(body), [2]);
  });

  test('мусор вместо тела не ломает разбор', () => {
    assert.deepEqual(closingIssues(undefined), []);
    assert.deepEqual(closingIssues(null), []);
    assert.deepEqual(closingIssues(42), []);
    assert.deepEqual(closingIssues(''), []);
    assert.deepEqual(closingIssues('Closes #0'), [], 'номер 0 не issue');
    assert.deepEqual(closingIssues('Closes #abc'), []);
  });

  test('strippedBody вырезает комментарии и код, оставляя текст', () => {
    const body = '<!-- подсказка -->\nТекст\n```\ncode\n```\nКонец';
    const stripped = strippedBody(body);
    assert.ok(!stripped.includes('подсказка'));
    assert.ok(!stripped.includes('code'));
    assert.ok(stripped.includes('Текст') && stripped.includes('Конец'));
  });
});

describe('missingReferenceReason: тексты отказа', () => {
  test('ссылка есть — отказа нет', () => {
    assert.equal(missingReferenceReason('Closes #5'), null);
  });

  test('пустое тело — отдельный текст про пустоту', () => {
    const reason = missingReferenceReason('   ');
    assert.ok(reason !== null);
    assert.match(reason, /Тело PR пустое/u);
    assert.match(reason, /Closes #12/u);
  });

  test('тело без ссылки — объяснение с примером и напоминанием про шаблон', () => {
    const reason = missingReferenceReason('## Что сделано\n\nCloses #\n');
    assert.ok(reason !== null);
    assert.match(reason, /нет ссылки на issue/u);
    assert.match(reason, /Closes #<номер>/u);
    assert.match(reason, /#5 и #15/u);
    assert.match(reason, /ссылкой не считается/u);
  });
});

describe('main: CLI', () => {
  /**
   * Прогон CLI с перехватом вывода.
   * @param {Record<string, string|undefined>} env
   * @param {{ readStdIn?: () => string }} [options]
   * @returns {{ code: number, out: string[], err: string[] }}
   */
  function runMain(env, options = {}) {
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const err = [];
    const code = main({
      env,
      readStdIn: options.readStdIn,
      log: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });
    return { code, out, err };
  }

  test('PR_BODY со ссылкой — код 0 и номер в выводе', () => {
    const { code, out } = runMain({ PR_BODY: 'Closes #15' });
    assert.equal(code, 0);
    assert.match(out.join('\n'), /закрывает issue #15/u);
  });

  test('PR_BODY без ссылки — код 2 и аннотация ::error:: для интерфейса PR', () => {
    const { code, err } = runMain({ PR_BODY: 'ничего не закрывает' });
    assert.equal(code, 2);
    assert.ok(
      err.some((line) => line.startsWith('::error::')),
      'аннотация для Actions',
    );
  });

  test('тело из stdin, когда PR_BODY не задан', () => {
    const { code, out } = runMain({}, { readStdIn: () => 'Closes #7' });
    assert.equal(code, 0);
    assert.match(out.join('\n'), /#7/u);
  });

  test('ни PR_BODY, ни stdin — отказ с текстом про пустое тело', () => {
    const { code, err } = runMain({});
    assert.equal(code, 2);
    assert.match(err.join('\n'), /Тело PR пустое/u);
  });
});
