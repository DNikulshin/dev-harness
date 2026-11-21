#!/usr/bin/env node
/**
 * Проверка «номера issue в репозитории существуют» по сети (issue #147).
 *
 * Зачем механизм, а не снимок. `scripts/dead-issue-refs.test.mjs` держит **известные** мёртвые
 * номера без сети, поэтому опечатка в новом номере или ссылка на PR, который ещё не создан,
 * проходят `pnpm check` зелёными — ровно тот дефект, который закрывал #129. Здесь номера
 * собираются из тех же областей (`scripts/`, `docs/`) по тем же исключениям, что и в тесте
 * (`scripts/lib/issue-refs.mjs`), и резолвятся через `gh api`.
 *
 * Что считается мёртвым: `gh api` ответил `404`. Всё остальное — отсутствие `gh`, отсутствие
 * авторизации, rate limit, сеть — это «не знаю», а не «номер есть»: код выхода `3` отделяет
 * неизвестность от зелёного прогона. Ложный зелёный здесь дороже пропущенного дефекта: он
 * означал бы «проверено» там, где ничего не проверялось.
 *
 * Снимок генерируется, а не правится руками: `--write-snapshot` переписывает `DEAD_REFS`,
 * `SNAPSHOT_DATE` и `MAX_REF_AT_SNAPSHOT` в `scripts/dead-issue-refs.test.mjs` из результата
 * прогона. Связка: сеть находит, снимок фиксирует, unit-тест держит в офлайне. Мёртвый номер не
 * выше максимального существующего — повод для ручной проверки (нумерация в трекере
 * последовательная), и такой снимок автоматически не пишется.
 *
 * Кэш резолва — `.cache/issue-refs.json` (каталог в `.gitignore`, в пакет не попадает):
 * суточный прогон и серия PR не должны упираться в rate limit. Неизвестный результат не кэшируется
 * никогда. `--no-cache` выключает чтение и запись.
 *
 * Использование:
 * ```
 * node tooling/check-issue-refs.mjs                   # проверка (прогон по расписанию)
 * node tooling/check-issue-refs.mjs --write-snapshot  # обновить снимок в тесте
 * node tooling/check-issue-refs.mjs --no-cache        # без кэша
 * ```
 * Репозиторий берётся из `REPO`, `GITHUB_REPOSITORY` (в Actions задан) или из `gh repo view`.
 *
 * Коды выхода: `0` — все номера существуют (с `--write-snapshot` — снимок записан);
 * `2` — есть мёртвые номера, они перечислены с адресами `файл:строка`; `3` — `gh`, сеть или
 * авторизация недоступны, часть номеров проверить не удалось; `1` — ошибка использования.
 *
 * Инфраструктура репозитория, а не часть пакета (ADR 0003): потребителю не поставляется.
 *
 * Shebang нужен: скрипт запускается напрямую из workflow.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectRun } from '../scripts/lib/cycle/cli.mjs';
import { writeTextAtomic } from '../scripts/lib/cycle/io.mjs';
import {
  collectRefs,
  deadOccurrences,
  formatOccurrence,
  refNumbers,
} from '../scripts/lib/issue-refs.mjs';
import { ghJson } from './gh-cli.mjs';

/** Корень репозитория: родитель каталога `tooling/`. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Файл снимка: тот самый тест, который держит мёртвые номера в офлайне. */
const SNAPSHOT_FILE = 'scripts/dead-issue-refs.test.mjs';

/** Кэш резолва между прогонами. */
const CACHE_FILE = '.cache/issue-refs.json';

/** Срок жизни записи кэша: суточный прогон и серия PR укладываются в один резолв. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Сколько ждём ответ `gh` на один номер. */
const GH_TIMEOUT_MS = 15_000;

/** Номер существует (issue или PR — нумерация общая). */
export const EXISTS = 'exists';

/** Номера нет: `gh` ответил 404. */
export const DEAD = 'dead';

/** Проверить не удалось: сеть, авторизация, rate limit. Не путать с «существует». */
export const UNKNOWN = 'unknown';

/** Подсказка по флагам: печатается при ошибке использования. */
const USAGE = [
  'Использование: node tooling/check-issue-refs.mjs [--write-snapshot] [--no-cache]',
  '  --write-snapshot  переписать снимок мёртвых номеров в scripts/dead-issue-refs.test.mjs',
  '  --no-cache        не читать и не писать кэш .cache/issue-refs.json',
].join('\n');

/**
 * Ответ `gh` → состояние номера. 404 — единственный признак «номера нет»: сообщения об
 * авторизации, rate limit и таймауте в `gh` тоже содержат слово `error`, поэтому проверяется
 * именно код ответа.
 * @param {{ ok: true, data: unknown } | { ok: false, reason: string }} result ответ `ghJson`
 * @returns {string} `EXISTS`, `DEAD` или `UNKNOWN`
 */
export function classifyGhResult(result) {
  if (result.ok) return EXISTS;
  if (/HTTP 404|\(404\)|Not Found/u.test(result.reason)) return DEAD;
  return UNKNOWN;
}

/**
 * Резолвер номера через `gh api`. PR и issue живут в одной нумерации и в одном эндпоинте,
 * поэтому одного запроса достаточно: `--jq .number` возвращает разобранный JSON.
 * @param {string} repo `owner/name`
 * @param {{ api?: typeof ghJson, timeoutMs?: number }} [options]
 * @returns {(ref: number) => string}
 */
export function ghRefFetcher(repo, { api = ghJson, timeoutMs = GH_TIMEOUT_MS } = {}) {
  return (ref) =>
    classifyGhResult(api(['api', `repos/${repo}/issues/${ref}`, '--jq', '.number'], { timeoutMs }));
}

/**
 * `owner/name` для `gh api`: переменные окружения (в Actions `GITHUB_REPOSITORY` уже задан) или
 * `gh repo view`. Неизвестный репозиторий — не повод угадывать: чужой трекер дал бы зелёный
 * прогон по чужим номерам.
 * @param {NodeJS.ProcessEnv} env
 * @param {typeof ghJson} [api]
 * @returns {string|null}
 */
export function repoName(env, api = ghJson) {
  for (const name of ['REPO', 'GITHUB_REPOSITORY']) {
    const value = env[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  const result = api(['repo', 'view', '--json', 'nameWithOwner'], { timeoutMs: GH_TIMEOUT_MS });
  if (!result.ok) return null;
  const data = /** @type {{ nameWithOwner?: unknown }} */ (result.data);
  const name = data?.nameWithOwner;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
}

/**
 * Кэш резолва из файла. Битый JSON, отсутствие файла и мусор в нём — не ошибка: кэш
 * необязателен, а падать из-за него значило бы делать проверку менее надёжной.
 * @param {string} file
 * @param {(file: string) => string} [read]
 * @returns {Map<number, { state: string, fetchedAt: number }>}
 */
export function readCache(file, read = (path) => readFileSync(path, 'utf8')) {
  /** @type {Map<number, { state: string, fetchedAt: number }>} */
  const cache = new Map();

  let parsed;
  try {
    parsed = JSON.parse(read(file));
  } catch {
    return cache;
  }
  if (parsed === null || typeof parsed !== 'object') return cache;

  for (const [key, value] of Object.entries(parsed)) {
    const ref = Number(key);
    if (!Number.isInteger(ref) || ref <= 0) continue;
    if (value === null || typeof value !== 'object') continue;
    const { state, fetchedAt } = /** @type {{ state?: unknown, fetchedAt?: unknown }} */ (value);
    if (state !== EXISTS && state !== DEAD) continue;
    if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) continue;
    cache.set(ref, { state, fetchedAt });
  }
  return cache;
}

/**
 * Состояния номеров с учётом кэша: свежая запись не требует запроса, протухшая — требует.
 * Запись из будущего (сбитые часы, скопированный файл) считается протухшей, а не вечной.
 * @param {number[]} numbers
 * @param {{
 *   fetch: (ref: number) => string,
 *   cache?: Map<number, { state: string, fetchedAt: number }>,
 *   now?: number,
 *   ttlMs?: number,
 * }} options
 * @returns {Map<number, { state: string, cached: boolean }>}
 */
export function resolveRefs(
  numbers,
  { fetch, cache = new Map(), now = Date.now(), ttlMs = CACHE_TTL_MS },
) {
  /** @type {Map<number, { state: string, cached: boolean }>} */
  const results = new Map();

  for (const ref of numbers) {
    const hit = cache.get(ref);
    const age = hit === undefined ? -1 : now - hit.fetchedAt;
    if (hit !== undefined && age >= 0 && age < ttlMs) {
      results.set(ref, { state: hit.state, cached: true });
      continue;
    }
    results.set(ref, { state: fetch(ref), cached: false });
  }
  return results;
}

/**
 * Номера в виде строк массива с отступами так, как их свернул бы prettier при `printWidth: 100`
 * (формат репозитория): заполнение строки до ширины, элементы через `, `. Сгенерированный снимок
 * обязан быть сразу отформатированным, иначе `pnpm check` краснеет из-за правки, которую никто не
 * делал руками.
 * @param {number[]} numbers
 * @param {{ indent?: number, width?: number }} [options]
 * @returns {string} строки без обрамляющих скобок; пустой список — пустая строка
 */
export function wrapNumbers(numbers, { indent = 2, width = 100 } = {}) {
  const prefix = ' '.repeat(indent);
  /** @type {string[]} */
  const lines = [];
  let line = '';

  for (const number of numbers) {
    const item = `${number},`;
    if (line === '') {
      line = prefix + item;
      continue;
    }
    if (line.length + 1 + item.length <= width) {
      line += ` ${item}`;
      continue;
    }
    lines.push(line);
    line = prefix + item;
  }
  if (line !== '') lines.push(line);
  return lines.join('\n');
}

/**
 * Снимок из текста теста: дата, максимум и список мёртвых номеров. Несовпадение шаблона —
 * исключение: это означает, что структура файла изменилась, и генерировать снимок вслепую нельзя.
 * @param {string} text
 * @returns {{ date: string, maxRef: number, deadRefs: number[] }}
 */
export function parseSnapshot(text) {
  const date = text.match(/const SNAPSHOT_DATE = '([^']*)';/u)?.[1];
  const maxRef = text.match(/const MAX_REF_AT_SNAPSHOT = (\d+);/u)?.[1];
  const list = text.match(/const DEAD_REFS = Object\.freeze\(\[([\s\S]*?)\]\);/u)?.[1];

  if (date === undefined || maxRef === undefined || list === undefined) {
    throw new Error('структура снимка в scripts/dead-issue-refs.test.mjs не распознана');
  }
  return {
    date,
    maxRef: Number(maxRef),
    deadRefs: [...list.matchAll(/\d+/gu)].map((match) => Number(match[0])),
  };
}

/**
 * Текст теста-снимка с обновлёнными `SNAPSHOT_DATE`, `MAX_REF_AT_SNAPSHOT` и `DEAD_REFS`.
 * Чистая функция: файл читает и пишет вызывающий.
 * @param {{ text: string, date: string, deadRefs: number[], maxRef: number }} input
 * @returns {string}
 */
export function renderSnapshot({ text, date, deadRefs, maxRef }) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(`дата снимка не в формате ISO: ${date}`);
  if (!Number.isInteger(maxRef) || maxRef < 0) throw new Error(`максимум ссылок: ${maxRef}`);
  parseSnapshot(text);

  const sorted = [...new Set(deadRefs)].sort((left, right) => left - right);
  const wrapped = wrapNumbers(sorted);
  const subs = [
    { pattern: /const SNAPSHOT_DATE = '[^']*';/u, replacement: `const SNAPSHOT_DATE = '${date}';` },
    {
      pattern: /const MAX_REF_AT_SNAPSHOT = \d+;/u,
      replacement: `const MAX_REF_AT_SNAPSHOT = ${maxRef};`,
    },
    {
      pattern: /const DEAD_REFS = Object\.freeze\(\[[\s\S]*?\]\);/u,
      replacement:
        wrapped === ''
          ? 'const DEAD_REFS = Object.freeze([]);'
          : `const DEAD_REFS = Object.freeze([\n${wrapped}\n]);`,
    },
  ];

  let next = text;
  for (const { pattern, replacement } of subs) {
    if (!pattern.test(next)) throw new Error(`в снимке нет строки ${String(pattern)}`);
    next = next.replace(pattern, replacement);
  }
  return next;
}

/**
 * Разбор флагов. Неизвестный флаг — ошибка, а не игнор: опечатка в `--write-snapshot` иначе
 * выглядела бы как обычная проверка, и снимок молча не обновился бы.
 * @param {string[]} argv
 * @returns {{ writeSnapshot: boolean, noCache: boolean, error?: string }}
 */
export function parseArgs(argv) {
  /** @type {{ writeSnapshot: boolean, noCache: boolean, error?: string }} */
  const options = { writeSnapshot: false, noCache: false };

  for (const arg of argv) {
    if (arg === '--write-snapshot') options.writeSnapshot = true;
    else if (arg === '--no-cache') options.noCache = true;
    else if (arg !== '') return { ...options, error: `неизвестный флаг: ${arg}` };
  }
  return options;
}

/**
 * Точка входа CLI: собирает ссылки, резолвит их, отчитывается и при необходимости пишет снимок.
 * Зависимости передаются параметрами, чтобы тесты не ходили в сеть и не писали в репозиторий.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   root?: string,
 *   argv?: string[],
 *   now?: () => number,
 *   log?: (line: string) => void,
 *   stderr?: (line: string) => void,
 *   readFile?: (file: string) => string,
 *   writeFile?: (file: string, text: string) => void,
 *   fetchRef?: (ref: number) => string,
 *   api?: typeof ghJson,
 * }} [deps]
 * @returns {number} код выхода
 */
export function main({
  env = process.env,
  root = ROOT,
  argv = process.argv.slice(2),
  now = () => Date.now(),
  log = console.log,
  stderr = console.error,
  readFile = (file) => readFileSync(file, 'utf8'),
  writeFile = (file, text) => writeTextAtomic(file, text),
  fetchRef,
  api = ghJson,
} = {}) {
  const args = parseArgs(argv);
  if (args.error !== undefined) {
    stderr(`check-issue-refs: ${args.error}`);
    for (const line of USAGE.split('\n')) stderr(line);
    return 1;
  }

  const occurrences = collectRefs(root);
  const numbers = refNumbers(occurrences);

  // Снимок не теряет прошлые записи: номер, уже зафиксированный мёртвым, остаётся в снимке,
  // пока не заведён в трекере. Иначе генерация стирала бы память о мёртвых номерах, которых
  // сейчас нет в репозитории, и возврат такого номера ловил бы только сетевой job.
  const snapshotFile = join(root, SNAPSHOT_FILE);
  let snapshotText = '';
  if (args.writeSnapshot) {
    try {
      snapshotText = readFile(snapshotFile);
      for (const ref of parseSnapshot(snapshotText).deadRefs) {
        if (!numbers.includes(ref)) numbers.push(ref);
      }
      numbers.sort((left, right) => left - right);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr(`check-issue-refs: снимок не прочитан: ${message}`);
      return 2;
    }
  }

  if (numbers.length === 0) {
    log('check-issue-refs: в scripts/ и docs/ нет ссылок на issues');
    return 0;
  }

  const cacheFile = join(root, CACHE_FILE);
  const cache = args.noCache ? new Map() : readCache(cacheFile, readFile);

  let fetch = fetchRef;
  if (fetch === undefined) {
    const repo = repoName(env, api);
    if (repo === null) {
      stderr(
        'check-issue-refs: репозиторий не определён — задайте REPO=owner/name или авторизуйте gh',
      );
      stderr('::error::check-issue-refs: репозиторий не определён, номера не проверены');
      return 3;
    }
    fetch = ghRefFetcher(repo, { api });
  }

  const timestamp = now();
  let results;
  try {
    results = resolveRefs(numbers, { fetch, cache, now: timestamp });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`check-issue-refs: резолв номеров не удался: ${message.split('\n')[0] ?? ''}`);
    stderr('::error::check-issue-refs: резолв номеров не удался, номера не проверены');
    return 3;
  }

  const fresh = [...results].filter(([, result]) => !result.cached);
  if (!args.noCache && fresh.length > 0) {
    writeCache(cacheFile, cache, fresh, timestamp, writeFile, stderr);
  }

  const dead = numbers.filter((ref) => results.get(ref)?.state === DEAD);
  const unknown = numbers.filter((ref) => results.get(ref)?.state === UNKNOWN);
  const cachedCount = [...results.values()].filter((result) => result.cached).length;
  log(
    `check-issue-refs: номеров ${numbers.length}, проверено сейчас ${numbers.length - cachedCount}, из кэша ${cachedCount}`,
  );

  if (args.writeSnapshot) {
    // Максимум считается по ссылкам репозитория, а не по прошлым записям снимка: прошлые — уже
    // мёртвые, и их номера максимум не поднимают.
    const repoRefs = refNumbers(occurrences);
    const maxRef = Math.max(0, ...repoRefs.filter((ref) => results.get(ref)?.state === EXISTS));
    const suspicious = dead.filter((ref) => ref <= maxRef);
    if (suspicious.length > 0) {
      stderr(
        `check-issue-refs: мёртвые номера не выше максимального существующего (#${maxRef}) — ` +
          `снимок не записан, проверьте вручную: ${listRefs(suspicious)}`,
      );
      return 2;
    }
    const file = snapshotFile;
    const date = new Date(timestamp).toISOString().slice(0, 10);
    try {
      writeFile(file, renderSnapshot({ text: snapshotText, date, deadRefs: dead, maxRef }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr(`check-issue-refs: снимок не записан: ${message}`);
      return 2;
    }
    log(
      `check-issue-refs: снимок ${SNAPSHOT_FILE} обновлён — ${dead.length} мёртвых номеров, максимум #${maxRef}`,
    );
    return 0;
  }

  for (const occurrence of deadOccurrences(occurrences, new Set(dead))) {
    stderr(formatOccurrence(occurrence));
  }
  if (unknown.length > 0) {
    stderr(
      `check-issue-refs: не удалось проверить ${unknown.length} номеров ` +
        `(${listRefs(unknown)}) — gh, сеть или авторизация недоступны`,
    );
    stderr(
      '::warning::check-issue-refs: часть номеров не проверена, результат не считается зелёным',
    );
    return 3;
  }
  if (dead.length > 0) {
    stderr(
      `check-issue-refs: мёртвые номера issue: ${listRefs(dead)} — ` +
        'снимите ссылку или заведите задачу, обоснование остаётся формулировкой правила (#129)',
    );
    stderr(`::error::check-issue-refs: ссылки на мёртвые номера: ${listRefs(dead)}`);
    return 2;
  }

  log(`check-issue-refs: все ${numbers.length} номеров существуют`);
  return 0;
}

/**
 * `#1, #2` — список номеров для сообщения одной строкой.
 * @param {number[]} refs
 * @returns {string}
 */
function listRefs(refs) {
  return refs.map((ref) => `#${ref}`).join(', ');
}

/**
 * Дописывает в кэш свежие результаты резолва. Сбой записи — предупреждение, а не отказ: кэш
 * ускоряет прогон, но не влияет на правильность проверки.
 * @param {string} file
 * @param {Map<number, { state: string, fetchedAt: number }>} cache загруженный кэш
 * @param {[number, { state: string, cached: boolean }][]} fresh резолвы текущего прогона
 * @param {number} timestamp
 * @param {(file: string, text: string) => void} writeFile
 * @param {(line: string) => void} stderr
 * @returns {void}
 */
function writeCache(file, cache, fresh, timestamp, writeFile, stderr) {
  const merged = new Map(cache);
  for (const [ref, result] of fresh) {
    if (result.state !== EXISTS && result.state !== DEAD) continue;
    merged.set(ref, { state: result.state, fetchedAt: timestamp });
  }

  /** @type {Record<string, { state: string, fetchedAt: number }>} */
  const data = {};
  for (const ref of [...merged.keys()].sort((left, right) => left - right)) {
    const entry = merged.get(ref);
    if (entry !== undefined) data[String(ref)] = entry;
  }

  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(
      `check-issue-refs: кэш не записан (${message.split('\n')[0] ?? ''}) — прогон продолжается`,
    );
  }
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) {
  process.exitCode = main();
}
