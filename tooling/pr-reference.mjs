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
 * Что не считается: упоминания внутри HTML-комментариев и блоков кода. Иначе шаблон PR
 * с примером `Closes #<номер>` или `Closes #12` в комментарии проходил бы проверку, ничего
 * не закрывая.
 *
 * Запуск: `node tooling/pr-reference.mjs` (в CI тело приходит в `PR_BODY`),
 * вручную: `PR_BODY="$(gh pr view 11 --json body --jq .body)" node tooling/pr-reference.mjs`.
 *
 * Коды выхода: `0` — ссылка есть; `2` — ссылки нет или тело пустое (в CI печатается
 * аннотация `::error::`, чтобы причина была видна в интерфейсе PR).
 *
 * Shebang нужен: скрипт запускается напрямую из workflow.
 */
import { readFileSync } from 'node:fs';

import { isDirectRun } from '../scripts/lib/cycle/cli.mjs';

/** Ключевые слова GitHub, закрывающие issue, и номер после `#`. */
const REFERENCE = /\b(?:closes|fixes|resolves)\s*:?\s*#(\d+)\b/giu;

/** Блок кода ``` … ``` или ~~~ … ~~~: примеры в теле PR — не ссылки. */
const FENCED_CODE = /^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$/gmu;

/** HTML-комментарий `<!-- … -->`: в шаблоне PR так подсказан формат ссылки. */
const HTML_COMMENT = /<!--[\s\S]*?-->/gu;

/**
 * Тело PR без блоков кода и HTML-комментариев: только по нему ищем ссылку.
 * @param {unknown} body
 * @returns {string}
 */
export function strippedBody(body) {
  if (typeof body !== 'string') return '';
  return body.replace(FENCED_CODE, '\n').replace(HTML_COMMENT, ' ');
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
    'Подсказка из шаблона «Closes #» без номера ссылкой не считается.',
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
 *   log?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} [deps]
 * @returns {number} код выхода
 */
export function main({
  env = process.env,
  readStdIn,
  log = console.log,
  stderr = console.error,
} = {}) {
  try {
    // `PR_BODY` — основной путь (workflow); stdin — для ручных прогонов через пайп.
    const body = env.PR_BODY ?? (readStdIn === undefined ? '' : readStdIn());
    const reason = missingReferenceReason(body);
    if (reason === null) {
      const issues = closingIssues(body);
      log(`pr-reference: PR закрывает issue ${issues.map((n) => `#${n}`).join(', ')}`);
      return 0;
    }

    for (const line of reason.split('\n')) stderr(line);
    // Аннотация Actions: причина видна в интерфейсе PR, а не только в логе прогона.
    stderr(`::error::${reason.split('\n')[0]}`);
    return 2;
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
