#!/usr/bin/env node
/**
 * Метрики завершённого цикла по docs/orchestrator-core.md §5.8 (issue #160, задача T8).
 *
 * Вход: `state.json` (обязателен), `gates.<n>.json` (обязателен для каждой итерации
 * `1..state.iteration`), `review.<n>.json`, `evaluation.<n>.json`, `decision.<n>.json`
 * (опциональны). Выход: `metrics.json` в каталоге цикла и одна строка JSON того же
 * документа в stdout. Диагностика — в stderr.
 *
 * Почему md не разбирается: единственный автор `review/evaluation.<n>.json` —
 * `cycle-decide` (D4), он пишет их только из валидного блока ```json. Метрики читают
 * уже нормализованные файлы и не дублируют разбор вывода агентов.
 *
 * Что считается и откуда:
 * - `stage_durations_s` — сумма `finished_at - started_at` по `state.history` для каждого
 *   этапа; записи без `finished_at` не считаются и видны в `unclosed_stages`. ISO со
 *   смещением даёт абсолютное время, поэтому полночь и часовой пояс на длительность
 *   не влияют;
 * - `cycle_duration_s` — сумма `stage_durations_s`, а не `updated_at - started_at`:
 *   в последнем сидят паузы супервизора между этапами;
 * - `gate_durations_s` и `gate_outcomes` — по всем итерациям: метрика описывает цикл,
 *   а поитерационные детали уже есть в `gates.<n>.json`;
 * - `review_findings` / `evaluator_defects` — суммы по итерациям из нормализованных
 *   артефактов ревью и оценки;
 * - `only_review` / `only_evaluator` / `both` — сопоставление находок с дефектами
 *   оценщика внутри одной итерации (диффы итераций разные, сравнивать между ними
 *   нечего): тот же файл и `|Δline| ≤ 5` (§5.6), жадно в порядке следования, каждый
 *   элемент участвует не больше одного раза. `preexisting` участвует: правило §5.6
 *   исключений для метрики не делает. Находка с пустым/нечисловым `file:line` и дефект
 *   без разбираемых ссылок в `evidence[]` не сопоставляются и попадают в `only_*`;
 * - `unresolved_refs` и `verdict_without_evidence` — суммы из `decision.<n>.json`;
 * - `evaluator_shares_family_with_plan` — вычисляется из `state.models` (§5.9: семейство —
 *   второй сегмент `model`). До T7 агента `evaluate` нет, ключа в `state.models` тоже,
 *   и тогда значение `true` по R2: независимость оценщика не подтверждена, поэтому
 *   консервативно фиксируем «в одном семействе», а не выдаём желаемое за факт;
 * - `tokens` — суммы по этапам из `usage.json` (его пишет `cycle-usage` по транскриптам
 *   субагентов). Нет файла — `null`: это не ноль токенов, а отсутствие замера;
 * - `cost_rub` — те же токены, оценённые по `evals/prices.json` и моделям из `state.models`.
 *   `null`, если `usage.json` нет, нет снапшота цен или хотя бы у одного этапа с расходом
 *   не известна модель: частичная сумма выдавала бы неполный расход за полный;
 * - `context` — контекст как измеримая величина (ADR 0009, #107): размер пакета `evidence/`
 *   по итерациям из снимков `manifest.<n>.json` (его пишет `cycle-evidence packet`, #106) с
 *   ростом к соседней предыдущей и списком новых файлов, плюс расход по стадиям и за цикл
 *   с долей кэша `cache_read / input`. Нет снимка — `null` в полях и имя файла в `missing`:
 *   «не мерили» — это не ноль; нет предыдущего снимка — нет и роста. Разреза токенов по
 *   итерациям нет: в `usage.json` его нет, и деление суммы на число итераций выдавало бы
 *   производное число за замер.
 *
 * Отсутствие `review`/`evaluation`/`decision` у итерации — не ошибка: цикл мог
 * эскалироваться раньше REVIEW, и вклад такой итерации в счётчики нулевой.
 *
 * Точность: длительности округляются до 3 знаков (миллисекунды). Суммы считаются
 * по округлённым слагаемым, поэтому `cycle_duration_s` равен сумме `stage_durations_s`,
 * а `gate_total_s` — сумме `gate_durations_s`. `-0` приводится к `0`, `NaN` и `Infinity`
 * недопустимы: неразбираемая дата в `history` — отказ (код 2) с указанием записи,
 * а не тихий ноль.
 *
 * Детерминизм: нет дат генерации и случайности, всё записываемое проходит `normalizeDoc`
 * (глубокая сортировка ключей). Повторный запуск на тех же входах даёт побайтно тот же
 * файл — это же свойство используется тестами и позволяет пересчитывать метрики при
 * досрочном вызове.
 *
 * Диагностика не содержит абсолютных путей и стектрейса (как в `check-harness.mjs`):
 * сообщения строятся из имён артефактов внутри каталога цикла, системный текст ошибок
 * Node (в нём есть абсолютный путь) не печатается — вместо него `error.code`.
 *
 * Коды выхода: `0` — `metrics.json` записан; `2` — ошибка использования или данных
 * (нет/битый `state.json` или `gates.<n>.json`, нарушена схема, мусор в аргументах).
 * Shebang нужен: файл запускается напрямую.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { normalizeDoc } from './cycle-decide.mjs';
import {
  describeJsonError,
  describeReadError,
  isRecord,
  normalizeUsage,
  priceUsage,
  readPriceSnapshot,
  readUsage,
  MODEL_STAGES,
} from './lib/cycle/cost.mjs';
import { isDirectRun } from './lib/cycle/cli.mjs';
import { parseJournal, summarizeJournal } from './lib/cycle/driver.mjs';
import { DEFAULTS, loadConfig, takeConfigOption } from './lib/cycle/config.mjs';
import { readJson, writeJsonAtomic } from './lib/cycle/io.mjs';
import { describedLimits, resolveLimits } from './lib/cycle/limits.mjs';
import {
  FIXED_NAMES,
  artifactsDir,
  findActiveCycle,
  iterNames,
  repoRoot,
} from './lib/cycle/paths.mjs';
import {
  validateDecision,
  validateEvaluation,
  validateGates,
  validateManifest,
  validateMetrics,
  validateReview,
  validateState,
} from './lib/cycle/validate.mjs';

/**
 * Стоимость и расход: те же функции, что у бюджетного порога `cycle-decide` —
 * реэкспорт ради тестов и внешних читателей. Источник истины — `lib/cycle/cost.mjs`.
 */
export { normalizeUsage, priceKeyFor, priceUsage } from './lib/cycle/cost.mjs';

/** Серьёзность находки ревью (Приложение A): все четыре значения считаются. */
const REVIEW_SEVERITIES = Object.freeze(['BLOCKER', 'MAJOR', 'MINOR', 'FOLLOW-UP']);

/** Серьёзность дефекта оценщика: `FOLLOW-UP` у него не бывает. */
const DEFECT_SEVERITIES = Object.freeze(['BLOCKER', 'MAJOR', 'MINOR']);

/** Статусы гейта (§5.5) — по ним ведутся исходы. */
const GATE_STATUSES = Object.freeze(['pass', 'fail', 'skipped', 'not_run']);

/** Допуск сопоставления находок в строках (§5.6). */
export const LINE_TOLERANCE = 5;

/** Знаков после запятой у длительностей в секундах. */
const DURATION_DIGITS = 3;

/** Множитель округления длительностей. */
const DURATION_FACTOR = 10 ** DURATION_DIGITS;

/** Знаков после запятой у отношений (`evidence_growth`, `cache_share`). */
const RATIO_DIGITS = 3;

/** Множитель округления отношений. */
const RATIO_FACTOR = 10 ** RATIO_DIGITS;

/**
 * @typedef {object} IterationInputs
 * @property {number} iteration номер итерации, целое ≥ 1
 * @property {Record<string, any>} gates проверенный `gates.<n>.json`
 * @property {Record<string, any>|null} review проверенный `review.<n>.json` или `null`
 * @property {Record<string, any>|null} evaluation проверенный `evaluation.<n>.json` или `null`
 * @property {Record<string, any>|null} decision проверенный `decision.<n>.json` или `null`
 */

/**
 * @typedef {object} ContextIteration
 * @property {number} iteration
 * @property {number|null} evidence_files
 * @property {number|null} evidence_bytes
 * @property {number|null} evidence_lines
 * @property {{ bytes: number|null, files: number|null }|null} evidence_growth отношение к предыдущей итерации
 * @property {string[]|null} new_files пути, впервые появившиеся в этой итерации
 */

/**
 * @typedef {object} ContextTokensRow
 * @property {number} input
 * @property {number} cache_read
 * @property {number} cache_write
 * @property {number} output
 * @property {number|null} cache_share `cache_read / input`; `null` при нулевом `input`
 */

/**
 * @typedef {object} Context
 * @property {ContextIteration[]} iterations по итерациям `1..state.iteration`, включая неизмеренные
 * @property {string[]} missing имена отсутствующих `manifest.<n>.json`
 * @property {Record<string, ContextTokensRow>|null} tokens по стадиям и `cycle`; `null` — `usage.json` нет
 */

/**
 * @typedef {object} Metrics
 * @property {number} iterations
 * @property {number} max_iterations
 * @property {string} final_stage
 * @property {Record<string, number>} stage_durations_s
 * @property {number} cycle_duration_s
 * @property {Record<string, number>} gate_durations_s
 * @property {number} gate_total_s
 * @property {Record<string, Record<string, number>>} gate_outcomes
 * @property {Record<string, number>} review_findings
 * @property {Record<string, number>} evaluator_defects
 * @property {number} only_review
 * @property {number} only_evaluator
 * @property {number} both
 * @property {number} unresolved_refs
 * @property {number} verdict_without_evidence
 * @property {number} unclosed_stages
 * @property {boolean} evaluator_shares_family_with_plan
 * @property {Record<string, { runs: number, input: number, cache_read: number, cache_write: number, output: number, reasoning: number }>|null} tokens
 * @property {number|null} cost_rub
 * @property {Context} context
 * @property {{ steps: number, executed: number, handed_off: number, mismatch: number }} [driver]
 */

/**
 * Секунды с фиксированной точностью. `-0` приводится к `0`, нечисло — исключение:
 * молча подставлять ноль нельзя, это скрыло бы битые входные данные.
 * @param {number} seconds
 * @param {string} label путь для сообщения
 * @returns {number}
 */
function roundSeconds(seconds, label) {
  if (!Number.isFinite(seconds)) {
    throw new Error(`${label}: длительность не является конечным числом`);
  }
  const rounded = Math.round(seconds * DURATION_FACTOR) / DURATION_FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Момент времени из ISO-8601. `Date.parse` понимает и `Z`, и смещение `+03:00`,
 * поэтому сравнивать можно записи с разными зонами.
 * @param {unknown} value
 * @param {string} label путь для сообщения
 * @returns {number} миллисекунды с начала эпохи
 */
function parseTime(value, label) {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms)) {
    throw new Error(`${label}: не разбирается как дата ISO-8601`);
  }
  return ms;
}

/**
 * Неотрицательный целый счётчик.
 * @param {unknown} value
 * @param {string} label
 * @returns {number}
 */
function countOf(value, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label}: ожидается целое ≥ 0`);
  }
  return value;
}

/**
 * Сумма значений карты; порядок ключей на результат не влияет.
 * @param {Record<string, number>} map
 * @returns {number}
 */
function sumValues(map) {
  return Object.values(map).reduce((total, value) => total + value, 0);
}

/**
 * Отношение с фиксированной точностью: отношение двух замеров (`evidence_growth`,
 * `cache_share`), а не длительность. `-0` приводится к `0`, нечисло — исключение.
 * @param {number} value
 * @param {string} label
 * @returns {number}
 */
function roundRatio(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label}: отношение не является конечным числом`);
  }
  const rounded = Math.round(value * RATIO_FACTOR) / RATIO_FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Строка расхода `context.tokens`: только поля, нужные для ответа «сколько контекста
 * стоил этап и сколько из него пришло из кэша». Доля кэша — `cache_read / input`;
 * при нулевом `input` она `null`, а не `0`: «кэша не было» и «замера нет» — разные факты
 * (ADR 0009).
 * @param {{ input: number, cache_read: number, cache_write: number, output: number }} source
 * @param {string} label
 * @returns {ContextTokensRow}
 */
function contextTokensRow(source, label) {
  return {
    input: source.input,
    cache_read: source.cache_read,
    cache_write: source.cache_write,
    output: source.output,
    cache_share: source.input === 0 ? null : roundRatio(source.cache_read / source.input, label),
  };
}

/**
 * Расход по стадиям и по циклу для блока `context`. Разреза по итерациям нет: в `usage.json`
 * его нет, а деление суммы на число итераций выдавало бы производное число за замер
 * (ADR 0009, пункт «в»).
 * @param {Record<string, import('./lib/cycle/cost.mjs').StageUsage>|null} tokens
 *   нормализованный `usage.json` (`metrics.tokens`) или `null`
 * @returns {Record<string, ContextTokensRow>|null}
 */
export function summarizeContextTokens(tokens) {
  if (tokens === null) return null;

  /** @type {Record<string, ContextTokensRow>} */
  const summary = {};
  /** @type {{ input: number, cache_read: number, cache_write: number, output: number }} */
  const cycle = { input: 0, cache_read: 0, cache_write: 0, output: 0 };

  // Порядок стадий — порядок автомата, а не порядок ключей в `usage.json`: отчёт и
  // `--html` не должны зависеть от того, как легли записи в файл.
  for (const stage of MODEL_STAGES) {
    const entry = tokens[stage];
    if (entry === undefined) continue;
    summary[stage] = contextTokensRow(entry, `context.tokens.${stage}.cache_share`);
    cycle.input += entry.input;
    cycle.cache_read += entry.cache_read;
    cycle.cache_write += entry.cache_write;
    cycle.output += entry.output;
  }

  summary.cycle = contextTokensRow(cycle, 'context.tokens.cycle.cache_share');
  return summary;
}

/**
 * Блок `context` из снимков `manifest.<n>.json` (ADR 0009, #107). Чистая функция:
 * файлов не читает и время не использует — снимки приходят готовыми.
 *
 * Три правила, без которых блок врал бы:
 *
 * - **не мерили — не ноль:** отсутствие `manifest.<n>.json` даёт `null` в полях итерации
 *   и имя файла в `missing`, а не нулевой размер;
 * - **рост — только к соседней итерации:** `evidence_growth` сравнивает итерацию `n` с `n-1`;
 *   если предыдущей нет (первая итерация или нет её снимка), роста тоже нет — `null`.
 *   Нулевой предыдущий размер доли не даёт — тоже `null`;
 * - **новые файлы — те, которых не было ни в одной предыдущей итерации;** у первой
 *   измеренной итерации новых файлов столько же, сколько файлов: они появляются впервые.
 *
 * Порядок итераций — номер, порядок путей — как в снимке (сортировка по строке).
 * @param {{
 *   iterationCount: number,
 *   manifests: (Record<string, any>|null)[],
 *   tokens?: Record<string, import('./lib/cycle/cost.mjs').StageUsage>|null,
 * }} options
 *   `manifests[i]` — проверенный `manifest.<i+1>.json` или `null`.
 * @returns {Context}
 */
export function buildContext({ iterationCount, manifests, tokens = null }) {
  /** @type {ContextIteration[]} */
  const iterations = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {Set<string>} */
  const seenPaths = new Set();

  for (let iteration = 1; iteration <= iterationCount; iteration += 1) {
    const doc = manifests[iteration - 1] ?? null;
    if (doc === null) {
      missing.push(iterNames(iteration).manifest);
      iterations.push({
        iteration,
        evidence_files: null,
        evidence_bytes: null,
        evidence_lines: null,
        evidence_growth: null,
        new_files: null,
      });
      continue;
    }

    const totals = /** @type {{ files: number, bytes: number, lines: number }} */ (doc.totals);
    const paths = /** @type {{ path: string }[]} */ (doc.files).map((file) => file.path);
    const newFiles = paths.filter((path) => !seenPaths.has(path));
    for (const path of paths) seenPaths.add(path);

    const previous = iteration === 1 ? null : (manifests[iteration - 2] ?? null);
    /** @type {{ bytes: number|null, files: number|null }|null} */
    let growth = null;
    if (previous !== null) {
      const previousTotals = /** @type {{ files: number, bytes: number }} */ (previous.totals);
      growth = {
        bytes:
          previousTotals.bytes === 0
            ? null
            : roundRatio(
                totals.bytes / previousTotals.bytes,
                `context.iterations.${iteration}.bytes`,
              ),
        files:
          previousTotals.files === 0
            ? null
            : roundRatio(
                totals.files / previousTotals.files,
                `context.iterations.${iteration}.files`,
              ),
      };
    }

    iterations.push({
      iteration,
      evidence_files: totals.files,
      evidence_bytes: totals.bytes,
      evidence_lines: totals.lines,
      evidence_growth: growth,
      new_files: newFiles,
    });
  }

  return { iterations, missing, tokens: summarizeContextTokens(tokens) };
}

/**
 * Позиция находки ревью: `file` после `trim` непустой и `line` — целое ≥ 1.
 * Всё остальное (`""`, `null`, строка, дробное) позицией не считается: такую находку
 * сопоставить не с чем (§5.6).
 * @param {unknown} finding
 * @returns {{ file: string, line: number }|null}
 */
function findingPosition(finding) {
  if (!isRecord(finding)) return null;
  const file = typeof finding.file === 'string' ? finding.file.trim() : '';
  const line = finding.line;
  if (file === '' || typeof line !== 'number' || !Number.isInteger(line) || line < 1) return null;
  return { file, line };
}

/** Ссылка `path:line` из `evidence[]` оценщика: файл непустой, строка — целое ≥ 1. */
const REF_PATTERN = /^(.+):([1-9]\d*)$/;

/**
 * Позиции дефекта оценщика. У дефекта нет собственных `file`/`line` (Приложение A),
 * поэтому место берётся из его свидетельств вида `path:line`; ссылки `gate:<id>` и
 * `qa:<id>` позицией не являются. Дефект без разбираемых ссылок сопоставить не с чем.
 * @param {unknown} defect
 * @returns {{ file: string, line: number }[]}
 */
function defectPositions(defect) {
  if (!isRecord(defect) || !Array.isArray(defect.evidence)) return [];
  const positions = [];
  for (const ref of defect.evidence) {
    if (typeof ref !== 'string') continue;
    const match = REF_PATTERN.exec(ref.trim());
    if (match === null) continue;
    const file = (match[1] ?? '').trim();
    const line = match[2];
    if (file === '' || line === undefined) continue;
    positions.push({ file, line: Number(line) });
  }
  return positions;
}

/**
 * Совпадает ли позиция находки с одной из позиций дефекта: тот же файл и
 * `|Δline| ≤ LINE_TOLERANCE` (§5.6).
 * @param {{ file: string, line: number }} finding
 * @param {{ file: string, line: number }[]} positions
 * @returns {boolean}
 */
function positionMatches(finding, positions) {
  return positions.some(
    (position) =>
      position.file === finding.file && Math.abs(position.line - finding.line) <= LINE_TOLERANCE,
  );
}

/**
 * Сопоставление находок ревью с дефектами оценщика (§5.6, «совпали»). Чистая функция:
 * порядок обхода фиксирован — находки в порядке следования, к каждой берётся первый
 * ещё не занятый дефект. Каждый элемент участвует не больше одного раза, поэтому
 * `both + only_review` равно числу находок, а `both + only_evaluator` — числу дефектов.
 * @param {unknown} [review] проверенный `review.<n>.json`, `null` или отсутствующий
 * @param {unknown} [evaluation] проверенный `evaluation.<n>.json`, `null` или отсутствующий
 * @returns {{ only_review: number, only_evaluator: number, both: number }}
 */
export function matchFindings(review, evaluation) {
  const reviewDoc = isRecord(review) ? review : {};
  const evaluationDoc = isRecord(evaluation) ? evaluation : {};
  const findings = Array.isArray(reviewDoc.findings) ? reviewDoc.findings : [];
  const defects = Array.isArray(evaluationDoc.defects) ? evaluationDoc.defects : [];
  const positions = defects.map(defectPositions);
  const used = new Array(defects.length).fill(false);

  let both = 0;
  let onlyReview = 0;

  for (const finding of findings) {
    const position = findingPosition(finding);
    const match =
      position === null
        ? -1
        : positions.findIndex((item, index) => !used[index] && positionMatches(position, item));

    if (match === -1) {
      onlyReview += 1;
      continue;
    }
    used[match] = true;
    both += 1;
  }

  return {
    only_review: onlyReview,
    only_evaluator: used.filter((value) => !value).length,
    both,
  };
}

/**
 * Семейство модели — второй сегмент `acme-ai/<семейство>/<модель>` (§5.9).
 * `null` — семейство вычислить нельзя: строки нет, сегментов меньше трёх или второй пуст.
 * @param {unknown} model
 * @returns {string|null}
 */
function modelFamily(model) {
  if (typeof model !== 'string') return null;
  const segments = model.split('/');
  if (segments.length < 3) return null;
  const family = (segments[1] ?? '').trim();
  return family === '' ? null : family;
}

/**
 * Оценщик в одном семействе с планом (предупреждение о потере независимости).
 *
 * Значение `true` означает «в том же семействе или это неизвестно»: метрика должна
 * предупреждать, а не успокаивать, поэтому неопределённость трактуется как совпадение.
 * Ключа `evaluate` в `state.models` до T7 нет (агент появится в T7), и по R2 в этом
 * случае возвращается `true` — иначе отсутствие данных читалось бы как подтверждённая
 * независимость. По той же причине не сравнивается `review`: пока оценивает ревьюер,
 * вопрос «оценщик против плана» ещё не имеет ответа.
 * @param {unknown} models `state.models`
 * @returns {boolean}
 */
export function evaluatorSharesFamilyWithPlan(models) {
  if (!isRecord(models)) return true;
  const evaluate = models.evaluate;
  if (typeof evaluate !== 'string') return true;
  const planFamily = modelFamily(models.plan);
  const evaluateFamily = modelFamily(evaluate);
  if (planFamily === null || evaluateFamily === null) return true;
  return planFamily === evaluateFamily;
}

/**
 * Считает метрики цикла. Чистая функция: файлов не читает и не пишет, время и
 * случайность не использует — на одних и тех же входах результат совпадает.
 *
 * Ожидает уже проверенные валидаторами документы, но не полагается на это: битая дата,
 * отрицательная или нечисловая длительность и нечисловые счётчики — исключение с
 * указанием записи (`state.history[i]`, `gates.<n>`), а не тихий ноль.
 * Токены и стоимость считаются только из переданных фактов: `usage` и `prices`.
 * `null` в обоих означает «замера нет», и это не то же самое, что ноль.
 * @param {{
 *   state: Record<string, any>,
 *   iterations: IterationInputs[],
 *   usage?: Record<string, any>|null,
 *   prices?: Record<string, import('./lib/evals/cost.mjs').ModelPrice>|null,
 *   appliedLimits?: Record<string, { value: number, source: string }>|null,
 *   driver?: { steps: number, executed: number, handed_off: number, mismatch: number }|null,
 *   manifests?: (Record<string, any>|null)[],
 * }} inputs
 *   `appliedLimits` — лимиты с источниками (#235): попав в `metrics.json`, они объясняют,
 *   по какому порогу считались бюджет и размер диффа. Считает CLI, а не эта функция.
 *   `driver` — сводка журнала `driver.jsonl` (#47): сколько шагов выдал драйвер, сколько
 *   исполнил сам и сколько раз состояние разошлось с его ответом. `null` — журнала нет.
 *   `manifests` — проверенные `manifest.<n>.json` по итерациям (ADR 0009): из них
 *   собирается блок `context`. Нет снимка — нет замера, а не ноль.
 * @returns {Metrics}
 */
export function buildMetrics({
  state,
  iterations,
  usage = null,
  prices = null,
  appliedLimits = null,
  driver = null,
  manifests = [],
}) {
  /** @type {Record<string, number>} */
  const stageTotals = {};
  const history = Array.isArray(state.history) ? state.history : [];
  let unclosed = 0;

  history.forEach((entry, index) => {
    const label = `state.history[${index}]`;
    if (!isRecord(entry)) throw new Error(`${label}: ожидается объект записи истории`);
    if (entry.finished_at === null || entry.finished_at === undefined) {
      unclosed += 1;
      return;
    }
    const started = parseTime(entry.started_at, `${label}.started_at`);
    const finished = parseTime(entry.finished_at, `${label}.finished_at`);
    const seconds = (finished - started) / 1000;
    if (seconds < 0) throw new Error(`${label}: finished_at раньше started_at`);
    const stage = String(entry.stage);
    stageTotals[stage] = (stageTotals[stage] ?? 0) + seconds;
  });

  /** @type {Record<string, number>} */
  const stageDurations = {};
  for (const [stage, seconds] of Object.entries(stageTotals)) {
    stageDurations[stage] = roundSeconds(seconds, `stage_durations_s.${stage}`);
  }

  /** @type {Record<string, number>} */
  const gateTotals = {};
  /** @type {Record<string, Record<string, number>>} */
  const gateOutcomes = {};
  /** @type {Record<string, number>} */
  /** @type {Record<string, number>} */
  const reviewFindings = Object.fromEntries(REVIEW_SEVERITIES.map((severity) => [severity, 0]));
  /** @type {Record<string, number>} */
  /** @type {Record<string, number>} */
  const evaluatorDefects = Object.fromEntries(DEFECT_SEVERITIES.map((severity) => [severity, 0]));
  let onlyReview = 0;
  let onlyEvaluator = 0;
  let both = 0;
  let unresolvedRefs = 0;
  let verdictWithoutEvidence = 0;

  for (const item of iterations) {
    const label = `gates.${item.iteration}`;
    const entries = Array.isArray(item.gates?.gates) ? item.gates.gates : [];

    entries.forEach((gate, index) => {
      const gateLabel = `${label}.gates[${index}]`;
      if (!isRecord(gate) || typeof gate.id !== 'string') {
        throw new Error(`${gateLabel}.id: ожидается строка`);
      }
      const duration = gate.duration_s;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
        throw new Error(`${gateLabel}.duration_s: ожидается число ≥ 0`);
      }
      const status = gate.status;
      if (typeof status !== 'string' || !GATE_STATUSES.includes(status)) {
        throw new Error(`${gateLabel}.status: ожидается одно из ${GATE_STATUSES.join('|')}`);
      }

      gateTotals[gate.id] = (gateTotals[gate.id] ?? 0) + duration;
      const outcomes = (gateOutcomes[gate.id] ??= Object.fromEntries(
        GATE_STATUSES.map((name) => [name, 0]),
      ));
      outcomes[status] = (outcomes[status] ?? 0) + 1;
    });

    const review = item.review ?? null;
    const evaluation = item.evaluation ?? null;

    for (const finding of Array.isArray(review?.findings) ? review.findings : []) {
      const severity = /** @type {{ severity?: unknown } | null} */ (finding)?.severity;
      if (typeof severity === 'string' && Object.hasOwn(reviewFindings, severity)) {
        reviewFindings[severity] = (reviewFindings[severity] ?? 0) + 1;
      }
    }
    for (const defect of Array.isArray(evaluation?.defects) ? evaluation.defects : []) {
      const severity = /** @type {{ severity?: unknown } | null} */ (defect)?.severity;
      if (typeof severity === 'string' && Object.hasOwn(evaluatorDefects, severity)) {
        evaluatorDefects[severity] = (evaluatorDefects[severity] ?? 0) + 1;
      }
    }

    const match = matchFindings(review, evaluation);
    onlyReview += match.only_review;
    onlyEvaluator += match.only_evaluator;
    both += match.both;

    if (item.decision !== null) {
      const decisionLabel = `decision.${item.iteration}`;
      unresolvedRefs += countOf(item.decision.unresolved_refs, `${decisionLabel}.unresolved_refs`);
      const counts = isRecord(item.decision.counts) ? item.decision.counts : {};
      verdictWithoutEvidence += countOf(
        counts.verdict_without_evidence ?? 0,
        `${decisionLabel}.counts.verdict_without_evidence`,
      );
    }
  }

  /** @type {Record<string, number>} */
  const gateDurations = {};
  for (const [id, seconds] of Object.entries(gateTotals)) {
    gateDurations[id] = roundSeconds(seconds, `gate_durations_s.${id}`);
  }

  const tokens = usage === null ? null : normalizeUsage(usage);
  const iterationCount = countOf(state.iteration, 'state.iteration');

  return {
    iterations: iterationCount,
    max_iterations: countOf(state.max_iterations, 'state.max_iterations'),
    final_stage: String(state.stage),
    stage_durations_s: stageDurations,
    cycle_duration_s: roundSeconds(sumValues(stageDurations), 'cycle_duration_s'),
    gate_durations_s: gateDurations,
    gate_total_s: roundSeconds(sumValues(gateDurations), 'gate_total_s'),
    gate_outcomes: gateOutcomes,
    review_findings: reviewFindings,
    evaluator_defects: evaluatorDefects,
    only_review: onlyReview,
    only_evaluator: onlyEvaluator,
    both,
    unresolved_refs: unresolvedRefs,
    verdict_without_evidence: verdictWithoutEvidence,
    unclosed_stages: unclosed,
    evaluator_shares_family_with_plan: evaluatorSharesFamilyWithPlan(state.models),
    tokens,
    cost_rub: tokens === null || prices === null ? null : priceUsage(tokens, state.models, prices),
    // Контекст как измеримая величина (ADR 0009): размер пакета по итерациям и доля кэша.
    // Блок есть всегда: `null` в полях и список `missing` сообщают «не мерили», а его
    // отсутствие читалось бы как «мерить нечего».
    context: buildContext({ iterationCount, manifests, tokens }),
    // Применённые лимиты цикла (#235): видно, с каким порогом считали бюджет и дифф.
    ...(appliedLimits === null ? {} : { applied_limits: appliedLimits }),
    // Маршрутизация кодом (#47): `mismatch = 0` — супервизор ни разу не разошёлся с драйвером.
    ...(driver === null ? {} : { driver }),
  };
}

/**
 * Разбирает аргументы командной строки. Любой мусор — ошибка использования (код 2).
 * @param {string[]} argv
 * @returns {{ dir: string|null }}
 */
export function parseArgs(argv) {
  /** @type {string|null} */
  let dir = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir') {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
        throw new Error('--dir: ожидается путь к каталогу цикла');
      }
      dir = value;
      index += 1;
      continue;
    }
    throw new Error(`неизвестный аргумент: ${arg}`);
  }

  return { dir };
}

/**
 * Читаемое представление артефакта: два пробела и завершающий перевод строки —
 * как у остальных артефактов цикла.
 * @param {unknown} data
 * @returns {string}
 */
function serializeArtifact(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * Читает обязательный JSON-артефакт и проверяет схему. Сообщения содержат только имя
 * артефакта внутри каталога цикла — без абсолютных путей.
 * @param {string} file
 * @param {(doc: unknown) => { ok: boolean, errors: string[] }} validator
 * @param {string} label имя артефакта для сообщения
 * @returns {Record<string, any>}
 */
function readRequiredJson(file, validator, label) {
  /** @type {unknown} */
  let doc;
  try {
    doc = readJson(file);
  } catch (error) {
    // Ошибки доступа к файлу приходят с `error.code`, ошибки разбора JSON — без него.
    const code = /** @type {{ code?: unknown } | undefined} */ (error)?.code;
    const reason = typeof code === 'string' ? describeReadError(error) : describeJsonError(error);
    throw new Error(`${label}: не читается (${reason})`, { cause: error });
  }

  const result = validator(doc);
  if (!result.ok) {
    throw new Error(`${label}: схема нарушена:\n${result.errors.join('\n')}`);
  }
  return /** @type {Record<string, any>} */ (doc);
}

/**
 * Читает необязательный JSON-артефакт: отсутствие файла — `null`, порча или нарушение
 * схемы — отказ (повреждённый артефакт исказил бы метрику молча).
 * @param {string} file
 * @param {(doc: unknown) => { ok: boolean, errors: string[] }} validator
 * @param {string} label
 * @returns {Record<string, any>|null}
 */
function readOptionalJson(file, validator, label) {
  if (!existsSync(file)) return null;
  return readRequiredJson(file, validator, label);
}

/**
 * Входы всех итераций `1..state.iteration`. `gates.<n>.json` обязателен: без него
 * итерация не дала ни одной метрики гейтов, и нули были бы догадкой.
 * @param {string} dir каталог цикла
 * @param {Record<string, any>} state проверенный `state.json`
 * @returns {IterationInputs[]}
 */
function readIterations(dir, state) {
  /** @type {IterationInputs[]} */
  const iterations = [];

  for (let iteration = 1; iteration <= state.iteration; iteration += 1) {
    const names = iterNames(iteration);
    iterations.push({
      iteration,
      gates: readRequiredJson(join(dir, names.gates), validateGates, names.gates),
      review: readOptionalJson(join(dir, names.reviewJson), validateReview, names.reviewJson),
      evaluation: readOptionalJson(
        join(dir, names.evaluationJson),
        validateEvaluation,
        names.evaluationJson,
      ),
      decision: readOptionalJson(join(dir, names.decision), validateDecision, names.decision),
    });
  }

  return iterations;
}

/**
 * Снимки размера пакета по итерациям (ADR 0009, #106). Нет файла — `null` в позиции
 * итерации: «не мерили» — это факт, и он попадёт в `context.missing`. Битый снимок —
 * отказ (код 2), как у остальных артефактов: испорченный агрегат исказил бы рост молча.
 * @param {string} dir каталог цикла
 * @param {Record<string, any>} state проверенный `state.json`
 * @returns {(Record<string, any>|null)[]} `manifests[i]` — `manifest.<i+1>.json` или `null`
 */
function readManifests(dir, state) {
  /** @type {(Record<string, any>|null)[]} */
  const manifests = [];

  for (let iteration = 1; iteration <= state.iteration; iteration += 1) {
    const names = iterNames(iteration);
    manifests.push(readOptionalJson(join(dir, names.manifest), validateManifest, names.manifest));
  }

  return manifests;
}

/**
 * Сводка журнала решений драйвера (#47). Нет файла — `null`: цикл вели без драйвера, и это
 * факт, а не ноль. Битая запись — исключение (код 2), а не тихий пропуск: `mismatch`
 * считается по журналу, и потерянная строка выдала бы себя за чистую маршрутизацию.
 * @param {string} dir каталог цикла
 * @returns {{ steps: number, executed: number, handed_off: number, mismatch: number }|null}
 */
export function readDriverJournal(dir) {
  const file = join(dir, FIXED_NAMES.driverJournal);
  if (!existsSync(file)) return null;
  return summarizeJournal(parseJournal(readFileSync(file, 'utf8')));
}

/**
 * Каталог цикла при запуске без `--dir`. Сообщение `findActiveCycle` содержит
 * абсолютный путь каталога артефактов; для диагностики он заменяется относительным.
 * @param {string} root корень репозитория
 * @param {ReturnType<typeof loadConfig>} [config] конфиг проекта
 * @returns {string} путь к каталогу активного цикла
 */
export function resolveCycleDir(root, config = loadConfig(root)) {
  const dir = artifactsDir(root, config);
  try {
    return findActiveCycle(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.split(dir).join(relative(root, dir) || dir), { cause: error });
  }
}

/**
 * Точка входа CLI. Пишет только `metrics.json` в каталог цикла; единственный вывод —
 * строка JSON в stdout, диагностика — в stderr.
 * @returns {void}
 */
function main() {
  try {
    const cli = takeConfigOption(process.argv.slice(2));
    const args = parseArgs(cli.argv);
    const root = repoRoot();
    const config = loadConfig(root, { file: cli.file });
    const dir = args.dir === null ? resolveCycleDir(root, config) : resolve(args.dir);

    const state = readRequiredJson(join(dir, FIXED_NAMES.state), validateState, FIXED_NAMES.state);
    // Лимиты (#235): env → конфиг → дефолт. Флагов у этого скрипта нет.
    const resolvedLimits = resolveLimits({
      config: config.limits,
      configured: config.limitsExplicit,
      env: process.env,
      defaults: DEFAULTS.limits,
      configLabel: config.configFile,
    });

    const metrics = buildMetrics({
      state,
      iterations: readIterations(dir, state),
      usage: readUsage(dir),
      prices: readPriceSnapshot(root, config.evals.prices),
      appliedLimits: describedLimits(resolvedLimits),
      driver: readDriverJournal(dir),
      manifests: readManifests(dir, state),
    });

    // Самопроверка: метрики обязаны проходить собственный валидатор (Приложение A).
    // Ошибка здесь — дефект писателя, а не входных данных, поэтому отдельный текст.
    const check = validateMetrics(metrics);
    if (!check.ok) {
      throw new Error(`metrics.json: нарушена схема (ошибка записи):\n${check.errors.join('\n')}`);
    }

    writeJsonAtomic(join(dir, FIXED_NAMES.metrics), normalizeDoc(metrics), {
      serialize: serializeArtifact,
    });
    process.stdout.write(`${JSON.stringify(normalizeDoc(metrics))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cycle-metrics: ${message}\n`);
    process.exitCode = 2;
  }
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) main();
