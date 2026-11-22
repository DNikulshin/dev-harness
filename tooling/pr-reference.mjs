#!/usr/bin/env node
/**
 * Проверка «в теле PR есть ссылка на issue»: `Closes #<номер>`.
 *
 * Зачем механизм, а не правило в документации: GitHub связывает issue **в момент мержа**
 * по ключевому слову в теле PR. Если тело собрано из шаблона (в нём `Closes #` без номера) или
 * из сообщения коммита, ссылки нет — PR влит, issue открыт, доска врёт. На практике это
 * случилось дважды (#5, #15): оба раза автозакрытие не сработало, и issue закрывали руками.
 * Проверка делает такое состояние невозможным: PR без ссылки не проходит обязательный `checks`.
 *
 * Что считается ссылкой: `closes`/`fixes`/`resolves` + `#<цифры>` в любом регистре, допустим
 * двоеточие (`Closes: #5`). Несколько ссылок — все засчитываются.
 *
 * Что не считается: упоминания внутри HTML-комментариев, блоков кода и строк в обратных
 * кавычках. Иначе шаблон PR с примером `Closes #<номер>` или `Closes #12` в комментарии проходил
 * бы проверку, ничего не закрывая. Inline-code важен отдельно: GitHub ключевое слово внутри
 * `` `Closes #4` `` не распознаёт, и проверка, которая его засчитывает, зелёная ровно там, где
 * issue останется открытым — так вышло с #4 в репозитории адаптера.
 *
 * Запуск: `node tooling/pr-reference.mjs` (в CI тело приходит в `PR_BODY`),
 * вручную: `PR_BODY="$(gh pr view 11 --json body --jq .body)" node tooling/pr-reference.mjs`.
 *
 * Второе свойство — **сообщения коммитов** (#181). GitHub закрывает issue и по closing-слову в
 * сообщении коммита, причём разметка там не защищает: бэктики и блок кода ничего не экранируют.
 * Поэтому пример закрывающего слова с чужим номером в теле коммита закрывает чужой issue при
 * мерже — так и вышло у адаптера, где номер из примера совпал с открытым issue. Проверка ищет
 * closing-слова в сообщениях без вырезания разметки и падает, если номер не закрывается телом PR.
 *
 * Коды выхода: `0` — ссылки на месте; `2` — ссылки нет, тело пустое или коммит тянет чужой issue
 * (в CI печатается аннотация `::error::`, чтобы причина была видна в интерфейсе PR).
 *
 * Shebang нужен: скрипт запускается напрямую из workflow.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { isDirectRun } from '../scripts/lib/cycle/cli.mjs';

/** Ключевые слова GitHub, закрывающие issue, и номер после `#`. */
const REFERENCE = /\b(?:closes|fixes|resolves)\s*:?\s*#(\d+)\b/giu;

/** Блок кода ``` … ``` или ~~~ … ~~~: примеры в теле PR — не ссылки. */
const FENCED_CODE = /^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$/gmu;

/** HTML-комментарий `<!-- … -->`: в шаблоне PR так подсказан формат ссылки. */
const HTML_COMMENT = /<!--[\s\S]*?-->/gu;

/**
 * Строка в обратных кавычках: `` `Closes #4` ``. GitHub внутри inline-code ключевое слово
 * не распознаёт, поэтому и проверка не должна его засчитывать.
 *
 * Содержимое — без перевода строки: иначе это уже не inline-code. Серии кавычек любой длины
 * (`` ``…`` ``) разбираются как одна строка; содержимое с «чужими» кавычками внутри
 * (`` ``a`b`` ``) распознаётся неточно, но на решение это не влияет — ссылка ищется в тексте
 * вне кавычек.
 */
const INLINE_CODE = /`+[^`\n]*?`+/gu;

/**
 * Тело PR без блоков кода и HTML-комментариев: только по нему ищем ссылку.
 * @param {unknown} body
 * @returns {string}
 */
export function strippedBody(body) {
  if (typeof body !== 'string') return '';
  // Порядок важен: сначала блоки кода (в них бывают одиночные кавычки), затем комментарии
  // и только потом inline-code — иначе кавычки внутри блоков съедят не тот фрагмент.
  return body.replace(FENCED_CODE, '\n').replace(HTML_COMMENT, ' ').replace(INLINE_CODE, ' ');
}

/**
 * Номера issue, которые PR закроет при мерже, в порядке появления и без повторов.
 * @param {unknown} body тело PR
 * @returns {number[]}
 */
export function closingIssues(body) {
  const text = strippedBody(body);
  /** @type {number[]} */
  const numbers = [];

  for (const match of text.matchAll(REFERENCE)) {
    const number = Number(match[1]);
    if (!Number.isInteger(number) || number <= 0) continue;
    if (!numbers.includes(number)) numbers.push(number);
  }
  return numbers;
}

/**
 * Номера issue из closing-слов в тексте сообщения коммита — **без вырезания разметки**.
 *
 * Отдельная функция от `closingIssues`, потому что правила разные: в теле PR примеры в блоках кода
 * и обратных кавычках ссылкой не считаются, а в сообщении коммита GitHub разметку не разбирает —
 * бэктики там бесполезны, и пример закрывает issue ровно так же, как намеренная ссылка.
 * @param {unknown} text текст сообщения коммита
 * @returns {number[]} номера issue
 */
export function rawClosingIssues(text) {
  if (typeof text !== 'string' || text === '') return [];
  /** @type {number[]} */
  const numbers = [];

  for (const match of text.matchAll(REFERENCE)) {
    const number = Number(match[1]);
    if (!Number.isInteger(number) || number <= 0) continue;
    if (!numbers.includes(number)) numbers.push(number);
  }

  return numbers;
}

/**
 * Проблемы в сообщениях коммитов PR: closing-слово, которое GitHub применит, а тело PR — нет.
 *
 * Избыточность не ошибка: коммит вправе повторить номер, который закрывает тело PR. Ошибка —
 * номер, которого там нет: при мерже закроется чужой issue, и доска покажет «Done» работе,
 * которую никто не делал.
 * @param {{messages?: unknown, closing?: unknown}} params сообщения коммитов и номера из тела PR
 * @returns {string[]} проблемы; пусто — расхождений нет
 */
export function commitReferenceProblems({ messages, closing } = {}) {
  const list = Array.isArray(messages) ? messages : typeof messages === 'string' ? [messages] : [];
  const allowed = new Set(
    Array.isArray(closing) ? closing.filter((number) => Number.isInteger(number)) : [],
  );
  /** @type {string[]} */
  const problems = [];

  for (const message of list) {
    if (typeof message !== 'string') continue;
    const foreign = rawClosingIssues(message).filter((number) => !allowed.has(number));
    if (foreign.length === 0) continue;

    const subject = (message.split('\n')[0] ?? '').trim();
    const numbers = foreign.map((number) => `#${number}`).join(', ');
    problems.push(
      `коммит «${subject}»: ${numbers} — GitHub закроет при мерже, а тело PR этого не делает`,
    );
  }

  return problems;
}

/**
 * Сообщения коммитов PR из git: `base..head` по SHA из окружения.
 *
 * Нужен неразрушающий диапазон, а не вся история: чужие коммиты базы ничего не закрывают.
 * `--format=%B%x00` — тело целиком и NUL как разделитель: сообщения многострочные.
 * @param {NodeJS.ProcessEnv} env окружение CI (`PR_BASE_SHA`, `PR_HEAD_SHA`)
 * @returns {string[]} сообщения коммитов; пусто, если SHA нет или git не ответил
 */
export function readCommitMessages(env) {
  const base = env.PR_BASE_SHA;
  const head = env.PR_HEAD_SHA;
  if (typeof base !== 'string' || typeof head !== 'string' || base === '' || head === '') return [];

  try {
    const out = execFileSync('git', ['log', '--format=%B%x00', `${base}..${head}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return out
      .split('\0')
      .map((message) => message.trim())
      .filter((message) => message !== '');
  } catch {
    return [];
  }
}

/**
 * Причина отказа или `null`, если ссылка на месте. Текст объясняет, что именно нужно
 * добавить: «нет ссылки» без примера заставляет угадывать формат.
 * @param {unknown} body тело PR
 * @returns {string|null}
 */
export function missingReferenceReason(body) {
  const text = typeof body === 'string' ? body : '';
  if (text.trim() === '') {
    return [
      'Тело PR пустое — в нём нет ссылки на issue.',
      'Добавьте строку вида «Closes #12»: GitHub закроет issue при мерже, доска обновится сама.',
    ].join('\n');
  }
  if (closingIssues(text).length > 0) return null;

  return [
    'В теле PR нет ссылки на issue: нужна строка вида «Closes #<номер>».',
    'Без неё issue не закроется при мерже, а доска останется в прежней колонке —',
    'именно так issue #5 и #15 остались открытыми после влитых PR.',
    'Подсказка из шаблона «Closes #» без номера, примеры в блоках кода и «Closes #N»',
    'в обратных кавычках ссылкой не считаются: GitHub внутри кода ключевое слово не распознаёт.',
  ].join('\n');
}

/**
 * Первая строка сообщения: в аннотацию CI не нужно многострочное полотно.
 * @param {unknown} error
 * @returns {string}
 */
function firstLine(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? '';
}

/**
 * Точка входа CLI.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   readStdIn?: () => string,
 *   readCommits?: (env: NodeJS.ProcessEnv) => string[],
 *   log?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} [deps]
 * @returns {number} код выхода
 */
export function main({
  env = process.env,
  readStdIn,
  readCommits = readCommitMessages,
  log = console.log,
  stderr = console.error,
} = {}) {
  try {
    // `PR_BODY` — основной путь (workflow); stdin — для ручных прогонов через пайп.
    const body = env.PR_BODY ?? (readStdIn === undefined ? '' : readStdIn());
    const reason = missingReferenceReason(body);
    if (reason !== null) {
      for (const line of reason.split('\n')) stderr(line);
      // Аннотация Actions: причина видна в интерфейсе PR, а не только в логе прогона.
      stderr(`::error::${reason.split('\n')[0]}`);
      return 2;
    }

    const issues = closingIssues(body);
    const problems = commitReferenceProblems({ messages: readCommits(env), closing: issues });
    if (problems.length > 0) {
      for (const problem of problems) stderr(problem);
      stderr(
        '::error::В сообщении коммита есть закрывающее слово с номером, которого тело PR не закрывает: ' +
          'при мерже GitHub закроет чужой issue. Уберите пример из текста коммита.',
      );
      return 2;
    }

    log(
      `pr-reference: PR закрывает issue ${issues.map((n) => `#${n}`).join(', ')}; ` +
        'в сообщениях коммитов чужих номеров нет',
    );
    return 0;
  } catch (error) {
    stderr(`pr-reference: ${firstLine(error)}`);
    return 2;
  }
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) {
  process.exitCode = main({
    readStdIn: () => {
      try {
        return readFileSync(0, 'utf8');
      } catch {
        return '';
      }
    },
  });
}
