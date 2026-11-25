/**
 * Тесты `tooling/pr-reference.mjs`.
 *
 * Проверяется главное свойство: подсказка шаблона и примеры в блоках кода ссылкой не считаются,
 * а настоящая строка `Closes #N` — считается. Ошибка в любую сторону дорога: ложное «есть»
 * оставит issue открытым после мержа, ложное «нет» заблокирует нормальный PR.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  closingIssues,
  commitReferenceProblems,
  main,
  missingReferenceReason,
  rawClosingIssues,
  readCommitMessages,
  strippedBody,
} from './pr-reference.mjs';

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

  test('строка в обратных кавычках не засчитывается: GitHub в коде ключевое слово не видит', () => {
    assert.deepEqual(closingIssues('`Closes #4`'), []);
    assert.deepEqual(closingIssues('тело: `Closes: #4` и всё'), []);
    assert.deepEqual(closingIssues('``Closes #4``'), []);
  });

  test('пример команды в кавычках — не ссылка, а настоящая строка рядом — ссылка', () => {
    const body = [
      'Так делать не нужно: `git commit -m "Closes #5"` — коммит issue не закрывает.',
      '',
      'Closes #7',
    ].join('\n');
    assert.deepEqual(closingIssues(body), [7]);
  });

  test('код в кавычках не мешает ссылке в том же абзаце', () => {
    assert.deepEqual(closingIssues('правило `#N` и ссылка Closes #12'), [12]);
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

  test('strippedBody вырезает и inline-code, оставляя текст вокруг', () => {
    const stripped = strippedBody('до `в кавычках` после');
    assert.ok(!stripped.includes('в кавычках'), 'содержимое кавычек вырезано');
    assert.match(stripped, /до\s+после/u);
  });
});

describe('rawClosingIssues: разметка в коммитах не защищает', () => {
  test('бэктики и блок кода в сообщении коммита не спасают от закрытия', () => {
    // GitHub сканирует сообщение как есть: на живых данных пример в теле коммита закрыл issue #16.
    assert.deepEqual(rawClosingIssues('пример: `Closes #16` в тексте'), [16]);
    assert.deepEqual(rawClosingIssues('```\nCloses #16\n```'), [16]);
  });

  test('формы и мусор', () => {
    assert.deepEqual(rawClosingIssues('Closes #9'), [9]);
    assert.deepEqual(rawClosingIssues('closes: #9 и fixes #2'), [9, 2]);
    assert.deepEqual(rawClosingIssues('Closes #0'), []);
    assert.deepEqual(rawClosingIssues(undefined), []);
  });
});

describe('commitReferenceProblems: чужие номера в коммитах', () => {
  test('номер, который PR не закрывает — проблема, с коммитом и номером', () => {
    const problems = commitReferenceProblems({
      messages: ['feat(x): сделано\n\nпример: `Closes #16` в тексте'],
      closing: [181],
    });

    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /коммит «feat\(x\): сделано»/u);
    assert.match(problems[0] ?? '', /#16/u);
    assert.match(problems[0] ?? '', /тело PR этого не делает/u);
  });

  test('номер из тела PR в коммите — не проблема: избыточность не ломает мерж', () => {
    assert.deepEqual(
      commitReferenceProblems({ messages: ['fix(x): Closes #181'], closing: [181] }),
      [],
    );
  });

  test('несколько коммитов и несколько чужих номеров сразу', () => {
    const problems = commitReferenceProblems({
      messages: ['a: Closes #1 и #2', 'b: ничего', 'c: fixes #3'],
      closing: [2],
    });

    assert.equal(problems.length, 2);
    // В список проблем попадают только чужие номера: свой (#2) остаётся в цитате коммита, но не в перечне.
    assert.match(problems[0] ?? '', /: #1 — /u);
    assert.match(problems[1] ?? '', /: #3 — /u);
  });

  test('мусор вместо сообщений не ломает разбор', () => {
    assert.deepEqual(commitReferenceProblems({}), []);
    assert.deepEqual(commitReferenceProblems({ messages: [1, null, ''], closing: undefined }), []);
    assert.deepEqual(commitReferenceProblems({ messages: 'Closes #5', closing: [] }), [
      'коммит «Closes #5»: #5 — GitHub закроет при мерже, а тело PR этого не делает',
    ]);
  });
});

describe('readCommitMessages: диапазон base..head', () => {
  test('без SHA — пусто, без обращения к git', () => {
    assert.deepEqual(readCommitMessages({}), []);
    assert.deepEqual(readCommitMessages({ PR_BASE_SHA: 'abc' }), []);
  });

  test('несуществующий диапазон — пусто, а не исключение', () => {
    assert.deepEqual(readCommitMessages({ PR_BASE_SHA: 'deadbeef', PR_HEAD_SHA: 'cafebabe' }), []);
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
    assert.match(reason, /ссылкой не счита/u);
    assert.match(reason, /кавычках/u);
  });
});

describe('main: CLI', () => {
  /**
   * Прогон CLI с перехватом вывода.
   * @param {Record<string, string|undefined>} env окружение
   * @param {{ readStdIn?: () => string, readCommits?: () => string[] }} [options] подмены зависимостей
   * @returns {{ code: number, out: string[], err: string[] }} код и строки вывода
   */
  function runMain(env, options = {}) {
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const err = [];
    const code = main({
      env,
      readStdIn: options.readStdIn,
      readCommits: options.readCommits ?? (() => []),
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

  test('чужой номер в сообщении коммита — код 2 и аннотация про коммит', () => {
    const { code, err } = runMain(
      { PR_BODY: 'Closes #181' },
      { readCommits: () => ['fix(x): пример `Closes #16` в тексте'] },
    );

    assert.equal(code, 2);
    assert.ok(
      err.some((line) => line.includes('#16')),
      'номер назван',
    );
    assert.ok(err.some((line) => line.startsWith('::error::') && line.includes('коммит')));
  });

  test('коммит повторяет номер из тела — код 0', () => {
    const { code, out } = runMain(
      { PR_BODY: 'Closes #181' },
      { readCommits: () => ['fix(x): Closes #181'] },
    );

    assert.equal(code, 0);
    assert.match(out.join('\n'), /чужих номеров нет/u);
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

/**
 * Условие запуска самой проверки живёт в YAML, а не в коде, поэтому регрессия там невидима
 * тестам — так и вышло в #209: условие по актору пропускало только прогоны бота, а прогон,
 * запущенный владельцем, падал на PR Dependabot и делал его неворуемым (issue #216).
 */
describe('workflow pr-checks.yml', () => {
  const WORKFLOW = readFileSync(
    new URL('../.github/workflows/pr-checks.yml', import.meta.url),
    'utf8',
  );
  // Комментарии обсуждают условие и актора — сравниваем только исполняемые строки.
  const COMMANDS = WORKFLOW.split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

  test('Dependabot пропускается по автору PR, а не по актору', () => {
    assert.match(COMMANDS, /if: github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'/u);
    assert.doesNotMatch(
      COMMANDS,
      /if: github\.actor/u,
      'условие по актору падает, когда PR бота трогает человек (#216)',
    );
  });

  test('job остаётся обязательным для обычных PR', () => {
    assert.match(COMMANDS, /^ {2}pr-references:$/mu, 'job называется pr-references');
    assert.match(COMMANDS, /run: node tooling\/pr-reference\.mjs/u);
  });
});
