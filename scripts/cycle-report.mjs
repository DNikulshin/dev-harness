#!/usr/bin/env node
/**
 * Сводка `metrics.json` по циклам (docs/orchestrator.md §11, §15, issue #224).
 *
 *   node scripts/cycle-report.mjs [--dir <каталог артефактов>] [--json | --html]
 *
 * Скрипт читает `metrics.json` каждого каталога цикла в `.pi/artifacts/` (по умолчанию),
 * проверяет документ валидатором схемы и печатает markdown-таблицу: расход, итерации,
 * длительность, вклад этапов и исходы гейтов. Данные нужны для решения §15 «оставлять ли
 * этап `evaluate`» и для калибровки бюджетного порога (§11): расход и доля находок,
 * которые принёс только оценщик, считаются по факту, а не по памяти.
 *
 * **Только факты.** Скрипт не выносит вердиктов и не сравнивает с порогами: пороги —
 * в `limits` конфига проекта и в §15, а здесь агрегат. Ничего не пишет на диск.
 *
 * **Контекст и кэш (ADR 0009, #108).** Колонки «Input-токены», «Доля кэша», «Размер пакета»
 * и «Рост evidence» берутся из блока `context` (`metrics.json`, #107): размер — последняя
 * измеренная итерация, рост — она же к первой (по байтам), расход — `context.tokens`.
 * Нет замера — в ячейке `insufficient_data`, а под таблицей — перечень недостающих
 * артефактов (`manifest.<n>.json`, `usage.json`, отсутствующий блок `context`): ноль
 * вместо отсутствия данных выдавал бы «не мерили» за «не выросло». Одна измеренная итерация
 * роста не даёт — там прочерк: «не с чем сравнивать» и «не изменилось» — разные факты.
 * Раздел «Контекст по стадиям» показывает те же input и долю кэша по этапам модели.
 *
 * **`--html` (#45).** Тот же отчёт одной самодостаточной страницей: стили внутри, без внешних
 * ресурсов и без JS — файл открывается с диска и в сеть не ходит (`> report.html` делает
 * человек, поэтому контракт «ничего не пишет на диск» сохраняется). Модель отчёта общая с
 * markdown: `renderHtml` и `renderMarkdown` берут один `Report`, второго источника правды нет.
 * Ширина полоски расхода — доля от максимума в отчёте, число подписано рядом; всё считается
 * из данных, поэтому два запуска дают побайтно одинаковую страницу.
 *
 * **Наблюдаемый минимум (#85, ADR [0006](./adr/0006-ui-presentation.md)).** Отчёт отвечает на
 * вопрос «почему цикл встал», а не только «сколько стоил»: каталоги с `state.json` без
 * `metrics.json` перечисляются блоком «Незавершённые циклы» (стадия, статус, итерация,
 * `updated_at`, повторы) вместо счётчика, а блок «Почему остановились» показывает вердикт
 * `decision.<n>.json` с причинами, эскалацию, критерии оценки не в статусе `met` и исходы
 * гейтов последней итерации. `fail` и `not_run` разведены по разным строкам, у `not_run` видна
 * причина (`no_database`, `tool_missing`, `blocked_by:<id>`); когда объяснять нечем (нет ни
 * решения, ни эскалации), печатается `insufficient_data`, а не догадка.
 *
 * **Что попадает в отчёт.** Каталоги с `state.json` и `metrics.json` — циклы с метриками;
 * каталоги без `metrics.json`, но со `state.json` — незавершённые. Каталоги без того и другого
 * считаются отдельно, чтобы «нет данных» не выглядело как «ноль». Битый или не проходящий схему
 * артефакт (метрики, состояние, решение, гейты, оценка, эскалация) — отказ (код 2): молча
 * пропустить испорченный артефакт значило бы занизить расход или выдумать причину.
 *
 * **Детерминизм.** Каталоги сортируются по имени, гейты — по порядку таблицы §5.5
 * (`gates` конфига проекта), неизвестные id — после них по алфавиту; время и случайность
 * не используются.
 * Два запуска на одном дереве дают побайтно одинаковый вывод.
 *
 * Коды выхода: `0` — отчёт напечатан; `2` — ошибка использования или данных (битый
 * `metrics.json`, нарушена схема, мусор в аргументах).
 * Shebang нужен: файл запускается напрямую.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isDirectRun } from './lib/cycle/cli.mjs';
import { loadConfig, takeConfigOption } from './lib/cycle/config.mjs';
import { readJson } from './lib/cycle/io.mjs';
import { FIXED_NAMES, artifactsDir, repoRoot } from './lib/cycle/paths.mjs';
import {
  validateDecision,
  validateEscalation,
  validateEvaluation,
  validateGates,
  validateMetrics,
  validateState,
} from './lib/cycle/validate.mjs';

/** Серьёзности дефектов оценщика (Приложение A). */
const DEFECT_SEVERITIES = Object.freeze(['BLOCKER', 'MAJOR', 'MINOR']);

/** Статусы гейта (§5.5) — по ним ведутся исходы. */
const GATE_STATUSES = Object.freeze(['pass', 'fail', 'skipped', 'not_run']);

/** Нет данных: в ячейке честная прочерк, а не ноль. */
const NO_VALUE = '—';

/**
 * Нет замера: в ячейке — явное «мерить нечем», а не ноль и не прочерк. Прочерк значал бы
 * «вопрос не применим», а здесь именно отсутствие данных (ADR 0009).
 */
const INSUFFICIENT = 'insufficient_data';

/** Блок `context` в `metrics.json` ещё не писался: старые артефакты до #107. */
const REASON_NO_CONTEXT = 'нет блока context в metrics.json';

/** Этапы, у которых есть расход токенов (§5.8). */
const MODEL_STAGES = Object.freeze(['plan', 'code', 'review', 'evaluate']);

/**
 * @typedef {object} StageContext
 * @property {string} stage этап модели (`plan`, `code`, `review`, `evaluate`)
 * @property {number} input input-токены этапа
 * @property {number|null} cache_share доля кэша этапа
 */

/**
 * @typedef {object} ContextSummary
 * @property {number|null} evidence_bytes размер пакета последней измеренной итерации
 * @property {number|null} evidence_files число файлов той же итерации
 * @property {number|null} evidence_growth отношение последней измеренной итерации к первой
 * @property {number|null} input input-токены цикла
 * @property {number|null} cache_share доля кэша цикла
 * @property {StageContext[]} stages расход по стадиям (порядок автомата)
 * @property {string[]} missing имена недостающих артефактов замера
 */

/**
 * @typedef {object} CycleSummary
 * @property {string} name имя каталога цикла
 * @property {string} final_stage `final_stage` из `metrics.json`
 * @property {number} iterations
 * @property {number} max_iterations
 * @property {number} duration_s
 * @property {number|null} cost_rub расход или `null`, если замера нет
 * @property {{ only_review: number, only_evaluator: number, both: number }} findings
 * @property {Record<string, number>} evaluator_defects
 * @property {Record<string, number>} review_findings
 * @property {number} unresolved_refs
 * @property {number} unclosed_stages
 * @property {Record<string, Record<string, number>>} gate_outcomes
 * @property {ContextSummary} context контекст и кэш (ADR 0009)
 */

/**
 * @typedef {object} PendingCycle
 * @property {string} name имя каталога цикла
 * @property {string} stage этап, на котором цикл остановился
 * @property {string} stage_status статус этапа (`running`, `error`, …)
 * @property {number} iteration текущая итерация
 * @property {number} max_iterations лимит итераций
 * @property {string} updated_at время последнего изменения состояния (ISO)
 * @property {{ REVIEW: number, EVALUATE: number, evidence: number }} retries повторы
 */

/**
 * @typedef {object} StopGate
 * @property {string} id
 * @property {'fail'|'not_run'} status
 * @property {string|null} reason причина `not_run` (`no_database`, `tool_missing`, …)
 */

/**
 * @typedef {object} StopCriterion
 * @property {string} id
 * @property {string} status `partial`, `unmet` или `unverified`
 */

/**
 * @typedef {object} Stop
 * @property {string} name имя каталога цикла
 * @property {string|null} action вердикт `decision.<n>.json` (`REWORK`, `ESCALATE`, …)
 * @property {string[]} reasons причины решения, как их записал `cycle-decide`
 * @property {string[]} unverified непроверенное из решения
 * @property {{ reason: string, detail: string|null }|null} escalation
 * @property {StopCriterion[]} criteria критерии оценки, кроме `met`
 * @property {StopGate[]} gates гейты последней итерации: `fail` и `not_run`
 * @property {string[]} missing каких артефактов нет (`decision`, `escalation`, `gates`)
 * @property {boolean} insufficient данных не хватает, чтобы назвать причину
 */

/**
 * @typedef {object} Report
 * @property {CycleSummary[]} cycles
 * @property {PendingCycle[]} pending каталоги со `state.json` без `metrics.json`
 * @property {Stop[]} stops почему остановились циклы (завершённые и эскалированные)
 * @property {number} skipped каталоги без `state.json` и без `metrics.json`
 * @property {{ measured: number, total: number, sum: number|null, median: number|null }} cost
 * @property {{ evaluator_only: number, total: number, percent: number|null }} findings
 * @property {{ id: string, pass: number, fail: number, skipped: number, not_run: number }[]} gates
 */

/**
 * Число из `metrics.json` или `0`: поля необязательны в смысле «нечего показывать».
 * @param {unknown} value
 * @returns {number}
 */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Округление до сотых — как в `metrics.cost_rub`.
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Округление отношения до тысячных — та же точность, что у `evidence_growth` в
 * `metrics.json` (ADR 0009): отчёт показывает число из артефакта, а не своё.
 * @param {number} value
 * @returns {number}
 */
function round3(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Медиана чисел; `null` для пустого списка. Для чётного числа — среднее двух средних
 * (так же считается `alert = 2 × медиана` в §11).
 * @param {unknown} values список чисел (не массив или пустой — `null`)
 * @returns {number|null}
 */
export function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return round2(upper);
  const lower = sorted[middle - 1] ?? 0;
  return round2((lower + upper) / 2);
}

/**
 * Процент от целого: `null`, если делить не на что. Одна цифра после запятой.
 * @param {number} part
 * @param {number} total
 * @returns {number|null}
 */
export function percent(part, total) {
  if (total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Строка расхода: рубли с копейками или прочерк, если замера не было.
 * @param {number|null} value
 * @returns {string}
 */
function rub(value) {
  return value === null ? NO_VALUE : value.toFixed(2);
}

/**
 * Строка процента.
 * @param {number|null} value
 * @returns {string}
 */
function percentText(value) {
  return value === null ? NO_VALUE : `${value.toFixed(1)}%`;
}

/**
 * Размер пакета `evidence/` человекочитаемо: байты до килобайта, дальше — КБ с одним знаком.
 * Пустого размера не бывает: 0 — это измеренный пустой пакет, а не отсутствие замера.
 * @param {number} bytes
 * @returns {string}
 */
function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

/**
 * Слово «файл» в нужной форме: 1 файл, 2 файла, 5 файлов, 11 файлов.
 * @param {number} value
 * @returns {string}
 */
function filesWord(value) {
  const tail = Math.abs(value) % 100;
  const last = tail % 10;
  if (tail >= 11 && tail <= 14) return 'файлов';
  if (last === 1) return 'файл';
  if (last >= 2 && last <= 4) return 'файла';
  return 'файлов';
}

/**
 * Ячейка «Размер пакета»: размер последней измеренной итерации и число файлов.
 * @param {ContextSummary} context
 * @returns {string}
 */
function evidenceText(context) {
  if (context.evidence_bytes === null || context.evidence_files === null) return INSUFFICIENT;
  return `${sizeText(context.evidence_bytes)} (${context.evidence_files} ${filesWord(context.evidence_files)})`;
}

/**
 * Ячейка «Рост evidence»: последняя измеренная итерация к первой. Одна итерация роста не
 * даёт — прочерк, а не единица: «не с чем сравнивать» и «не выросло» — разные факты.
 * @param {ContextSummary} context
 * @returns {string}
 */
function growthText(context) {
  if (context.evidence_bytes === null) return INSUFFICIENT;
  if (context.evidence_growth === null) return NO_VALUE;
  return `×${context.evidence_growth}`;
}

/**
 * Ячейка «Input-токены»: нет `usage.json` — `insufficient_data`, а не нули.
 * @param {number|null} value
 * @returns {string}
 */
function tokensText(value) {
  return value === null ? INSUFFICIENT : String(value);
}

/**
 * Ячейка «Доля кэша»: отношение из `context.tokens`, в процентах.
 * @param {number|null} value доля 0–1 или `null`
 * @param {boolean} measured был ли замер расхода
 * @returns {string}
 */
function cacheText(value, measured) {
  if (!measured) return INSUFFICIENT;
  return percentText(value === null ? null : value * 100);
}

/**
 * Перечень недостающих артефактов замера по циклам: `insufficient_data` в ячейке говорит
 * «мерить нечем», а эта строка — чем именно. Порядок — как в отчёте.
 * @param {CycleSummary[]} cycles
 * @returns {string[]}
 */
function contextGapsMarkdown(cycles) {
  const gaps = cycles.filter((cycle) => cycle.context.missing.length > 0);
  if (gaps.length === 0) return [];

  /** @type {string[]} */
  const lines = ['Нечем мерить (insufficient_data):'];
  for (const cycle of gaps) {
    lines.push(`- \`${cycle.name}\` — ${cycle.context.missing.join(', ')}`);
  }
  lines.push('');
  return lines;
}

/**
 * Строки таблицы «Контекст по стадиям»: по строке на цикл и стадию. Нет ни одного замера —
 * пусто, и раздел в отчёт не попадает.
 * @param {CycleSummary[]} cycles
 * @returns {CycleSummary[]}
 */
function cyclesWithStages(cycles) {
  return cycles.filter((cycle) => cycle.context.stages.length > 0);
}

/**
 * Подкаталоги каталога артефактов, отсортированные по имени: и циклы, и всё, что рядом с ними.
 * @param {string} dir каталог артефактов
 * @returns {string[]} имена каталогов
 */
export function listArtifactDirs(dir) {
  if (!existsSync(dir)) throw new Error(`${dir}: каталог артефактов не найден`);
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

/**
 * Каталоги циклов с `metrics.json` в каталоге артефактов, отсортированные по имени.
 * @param {string} dir каталог артефактов
 * @returns {string[]} имена каталогов
 */
export function listCycleDirs(dir) {
  return listArtifactDirs(dir).filter((name) => existsSync(join(dir, name, FIXED_NAMES.metrics)));
}

/**
 * Читает и проверяет артефакт цикла. Сообщение содержит имя каталога и файла, а не
 * абсолютный путь: отчёт можно вставлять в issue. Битый или не прошедший схему артефакт —
 * отказ, а не тихий пропуск: «файла нет» и «файл испорчен» — разные факты.
 * @param {string} cycleDir каталог цикла
 * @param {string} cycleName имя каталога цикла
 * @param {string} fileName имя файла внутри каталога
 * @param {(doc: unknown) => { ok: boolean, errors: string[] }} validate валидатор схемы
 * @returns {Record<string, any>}
 */
function readArtifact(cycleDir, cycleName, fileName, validate) {
  const file = join(cycleDir, fileName);

  /** @type {unknown} */
  let doc;
  try {
    doc = readJson(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${cycleName}/${fileName}: не читается (${message})`, { cause: error });
  }

  const check = validate(doc);
  if (!check.ok) {
    throw new Error(`${cycleName}/${fileName}: схема нарушена:\n${check.errors.join('\n')}`);
  }
  return /** @type {Record<string, any>} */ (doc);
}

/**
 * Последний по номеру файл итерации `base.<n>.json` в каталоге цикла. Перебор каталога не
 * зависит от порядка `readdir`: выбирается максимум номера.
 * @param {string} cycleDir каталог цикла
 * @param {string} base имя без номера и расширения (`decision`, `gates`, `evaluation`)
 * @returns {{ iteration: number, fileName: string }|null}
 */
export function lastIterationFile(cycleDir, base) {
  const pattern = new RegExp(`^${base}\\.(\\d+)\\.json$`, 'u');
  /** @type {{ iteration: number, fileName: string }|null} */
  let latest = null;
  for (const fileName of readdirSync(cycleDir)) {
    const match = pattern.exec(fileName);
    if (match === null) continue;
    const iteration = Number(match[1]);
    if (latest === null || iteration > latest.iteration) latest = { iteration, fileName };
  }
  return latest;
}

/**
 * Сводка контекста и кэша одного цикла из блока `context` (ADR 0009, #108). Чистая функция:
 * файлов не читает, ничего не додумывает.
 *
 * Три источника, три правила:
 *
 * - **размер пакета** — последняя **измеренная** итерация: у неё есть снимок
 *   `manifest.<n>.json`. Нет ни одного снимка — `null` и имя файла в `missing`;
 * - **рост evidence** — отношение последней измеренной итерации к первой. Одна измеренная
 *   итерация роста не даёт (сравнивать не с чем), а нулевая первая — не даёт доли;
 * - **расход** — только `context.tokens`: нет `usage.json` — `tokens: null`, и это `null`,
 *   а не нулевые токены.
 *
 * Отдельного поля «мерить нечем» нет намеренно: каждая колонка решает сама — у цикла
 * с расходом, но без снимков, `insufficient_data` только в колонках размера.
 * @param {Record<string, any>} metrics проверенный `metrics.json`
 * @returns {ContextSummary}
 */
export function summarizeContext(metrics) {
  /** @type {ContextSummary} */
  const empty = {
    evidence_bytes: null,
    evidence_files: null,
    evidence_growth: null,
    input: null,
    cache_share: null,
    stages: [],
    missing: [],
  };

  const block = metrics?.context;
  if (typeof block !== 'object' || block === null) {
    return { ...empty, missing: [REASON_NO_CONTEXT] };
  }

  /** @type {string[]} */
  const missing = Array.isArray(block.missing)
    ? /** @type {string[]} */ (
        block.missing.filter((/** @type {unknown} */ name) => typeof name === 'string')
      )
    : [];

  const iterations = /** @type {any[]} */ (Array.isArray(block.iterations) ? block.iterations : []);
  const measured = iterations.filter(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.evidence_bytes === 'number' &&
      typeof item.evidence_files === 'number',
  );
  const first = measured[0] ?? null;
  const last = measured[measured.length - 1] ?? null;

  const tokens = block.tokens;
  const tokenRows = typeof tokens === 'object' && tokens !== null ? tokens : null;
  if (tokenRows === null) missing.push(FIXED_NAMES.usage);

  /** @type {StageContext[]} */
  const stages = [];
  for (const stage of MODEL_STAGES) {
    const row = tokenRows?.[stage];
    if (typeof row !== 'object' || row === null) continue;
    if (typeof row.input !== 'number') continue;
    stages.push({
      stage,
      input: row.input,
      cache_share: typeof row.cache_share === 'number' ? row.cache_share : null,
    });
  }

  const cycle = tokenRows?.cycle;
  const hasCycleRow = typeof cycle === 'object' && cycle !== null;

  return {
    evidence_bytes: last === null ? null : last.evidence_bytes,
    evidence_files: last === null ? null : last.evidence_files,
    evidence_growth:
      first === null || last === null || first === last || first.evidence_bytes <= 0
        ? null
        : round3(last.evidence_bytes / first.evidence_bytes),
    // Итог цикла берётся из `cycle`, а не складывается из стадий: сумму стадий считает
    // `cycle-metrics`; второй счётчик тут стал бы вторым источником правды.
    input: hasCycleRow && typeof cycle.input === 'number' ? cycle.input : null,
    cache_share:
      hasCycleRow && (typeof cycle.cache_share === 'number' || cycle.cache_share === null)
        ? cycle.cache_share
        : null,
    stages,
    missing,
  };
}

/**
 * Сводка одного цикла: только поля, которые попадают в отчёт.
 * @param {string} name
 * @param {Record<string, any>} metrics
 * @returns {CycleSummary}
 */
export function summarizeCycle(name, metrics) {
  return {
    name,
    final_stage: metrics.final_stage,
    iterations: metrics.iterations,
    max_iterations: metrics.max_iterations,
    duration_s: metrics.cycle_duration_s,
    cost_rub: metrics.cost_rub ?? null,
    findings: {
      only_review: count(metrics.only_review),
      only_evaluator: count(metrics.only_evaluator),
      both: count(metrics.both),
    },
    evaluator_defects: Object.fromEntries(
      DEFECT_SEVERITIES.map((severity) => [severity, count(metrics.evaluator_defects?.[severity])]),
    ),
    review_findings: Object.fromEntries(
      ['BLOCKER', 'MAJOR', 'MINOR', 'FOLLOW-UP'].map((severity) => [
        severity,
        count(metrics.review_findings?.[severity]),
      ]),
    ),
    unresolved_refs: count(metrics.unresolved_refs),
    unclosed_stages: count(metrics.unclosed_stages),
    gate_outcomes: metrics.gate_outcomes ?? {},
    context: summarizeContext(metrics),
  };
}

/**
 * Сводка незавершённого цикла: только `state.json`, без вычислений и догадок.
 * @param {string} name имя каталога
 * @param {Record<string, any>} state проверенное состояние
 * @returns {PendingCycle}
 */
export function summarizePending(name, state) {
  const retries = state.retries ?? {};
  return {
    name,
    stage: state.stage,
    stage_status: state.stage_status,
    iteration: count(state.iteration),
    max_iterations: count(state.max_iterations),
    updated_at: state.updated_at,
    retries: {
      REVIEW: count(retries.REVIEW),
      EVALUATE: count(retries.EVALUATE),
      evidence: count(retries.evidence),
    },
  };
}

/**
 * Читает артефакты «почему встал» из каталога цикла. Критерии оценки берутся только из
 * `evaluation.<n>.json` той итерации, на которую ссылается решение: чужие критерии выдали бы
 * вердикт за свидетельство.
 * @param {string} cycleDir каталог цикла
 * @param {string} cycleName имя каталога цикла
 * @param {{ state?: Record<string, any>|null }} [options] уже прочитанное состояние
 * @returns {{
 *   decision: Record<string, any>|null,
 *   evaluation: Record<string, any>|null,
 *   escalation: Record<string, any>|null,
 *   gates: Record<string, any>|null,
 * }}
 */
export function collectStopArtifacts(cycleDir, cycleName, { state = null } = {}) {
  const decisionFile = lastIterationFile(cycleDir, 'decision');
  const decision =
    decisionFile === null
      ? null
      : readArtifact(cycleDir, cycleName, decisionFile.fileName, validateDecision);

  const evaluationName = decision === null ? null : `evaluation.${decision.iteration}.json`;
  const evaluation =
    evaluationName !== null && existsSync(join(cycleDir, evaluationName))
      ? readArtifact(cycleDir, cycleName, evaluationName, validateEvaluation)
      : null;

  const gatesFile = lastIterationFile(cycleDir, 'gates');
  const gates =
    gatesFile === null
      ? null
      : readArtifact(cycleDir, cycleName, gatesFile.fileName, validateGates);

  /** `escalate` пишет и `escalation.json`, и `state.escalation`: когда файла нет (цикл
   * эскалирован раньше появления файла или файл удалён), причина из состояния всё равно
   * остаётся фактом, а не поводом для `insufficient_data`. */
  const escalation = existsSync(join(cycleDir, FIXED_NAMES.escalation))
    ? readArtifact(cycleDir, cycleName, FIXED_NAMES.escalation, validateEscalation)
    : (state?.escalation ?? null);

  return { decision, evaluation, escalation, gates };
}

/**
 * Причина остановки цикла. Чистая функция: файлов не читает.
 *
 * `insufficient` — не догадка, а факт «объяснять нечем»: нет ни решения, ни эскалации. Гейты
 * сами по себе остановку не объясняют (их `pass` — свидетельство проверки), поэтому в это
 * условие не входят.
 * @param {string} name имя каталога цикла
 * @param {ReturnType<typeof collectStopArtifacts>} artifacts
 * @returns {Stop}
 */
export function summarizeStop(name, artifacts) {
  const { decision, evaluation, escalation, gates } = artifacts;

  /** @type {string[]} */
  const missing = [];
  if (decision === null) missing.push('decision');
  if (escalation === null) missing.push('escalation');
  if (gates === null) missing.push('gates');

  /** @type {{ id: string, status: string, reason: string|null }[]} */
  const gateRows = gates === null ? [] : gates.gates;
  const stopGates = /** @type {StopGate[]} */ (
    gateRows
      .filter((gate) => gate.status === 'fail' || gate.status === 'not_run')
      .map((gate) => ({ id: gate.id, status: gate.status, reason: gate.reason ?? null }))
  );

  /** @type {{ id: string, status: string }[]} */
  const criterionRows = evaluation === null ? [] : evaluation.criteria;
  const criteria = /** @type {StopCriterion[]} */ (
    criterionRows
      .filter((criterion) => criterion.status !== 'met')
      .map((criterion) => ({ id: criterion.id, status: criterion.status }))
  );

  return {
    name,
    action: decision === null ? null : decision.action,
    reasons: decision === null ? [] : [...decision.reasons],
    unverified: decision === null ? [] : [...decision.unverified],
    escalation:
      escalation === null ? null : { reason: escalation.reason, detail: escalation.detail ?? null },
    criteria,
    gates: stopGates,
    missing,
    insufficient: decision === null && escalation === null,
  };
}

/**
 * Исходы гейтов по всем циклам: суммы по `id`, порядок — таблица §5.5, затем алфавит.
 * @param {CycleSummary[]} cycles
 * @param {readonly string[]} [gateIds] порядок id из конфига проекта
 * @returns {Report['gates']}
 */
export function aggregateGates(cycles, gateIds = []) {
  const gateOrder = new Map(gateIds.map((id, index) => [id, index]));
  /** @type {Map<string, Record<string, number>>} */
  const totals = new Map();
  for (const cycle of cycles) {
    for (const [id, outcomes] of Object.entries(cycle.gate_outcomes)) {
      const fresh = /** @type {Record<string, number>} */ (
        Object.fromEntries(GATE_STATUSES.map((status) => [status, 0]))
      );
      const entry = totals.get(id) ?? fresh;
      totals.set(id, entry);
      for (const status of GATE_STATUSES)
        entry[status] = (entry[status] ?? 0) + count(outcomes?.[status]);
    }
  }

  return [...totals.entries()]
    .sort(([left], [right]) => {
      const leftIndex = gateOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = gateOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(
      ([id, entry]) =>
        /** @type {{ id: string, pass: number, fail: number, skipped: number, not_run: number }} */ ({
          id,
          ...entry,
        }),
    );
}

/**
 * Собирает отчёт из прочитанных артефактов. Чистая функция: файлов не читает.
 * @param {CycleSummary[]} cycles сводки по циклам (в порядке отчёта)
 * @param {{
 *   skipped?: number,
 *   gateIds?: readonly string[],
 *   pending?: PendingCycle[],
 *   stops?: Stop[],
 * }} [options]
 * @returns {Report}
 */
export function buildReport(cycles, { skipped = 0, gateIds = [], pending = [], stops = [] } = {}) {
  const costs = cycles.map((cycle) => cycle.cost_rub).filter((value) => value !== null);
  const evaluatorOnly = cycles.reduce((sum, cycle) => sum + cycle.findings.only_evaluator, 0);
  const totalFindings = cycles.reduce(
    (sum, cycle) =>
      sum + cycle.findings.only_review + cycle.findings.only_evaluator + cycle.findings.both,
    0,
  );

  return {
    cycles,
    pending,
    stops,
    skipped,
    cost: {
      measured: costs.length,
      total: cycles.length,
      sum: costs.length === 0 ? null : round2(costs.reduce((sum, value) => sum + value, 0)),
      median: median(costs),
    },
    findings: {
      evaluator_only: evaluatorOnly,
      total: totalFindings,
      percent: percent(evaluatorOnly, totalFindings),
    },
    gates: aggregateGates(cycles, gateIds),
  };
}

/**
 * Чего не хватает, чтобы объяснить остановку: имена файлов, а не внутренние ключи.
 * @param {string[]} missing
 * @returns {string}
 */
function missingText(missing) {
  const names = missing.map((kind) =>
    kind === 'decision'
      ? 'decision.<n>.json'
      : kind === 'gates'
        ? 'gates.<n>.json'
        : FIXED_NAMES.escalation,
  );
  return `нет ${names.join(', ')}`;
}

/**
 * Блок «Незавершённые циклы» в markdown: стадия, статус, итерация, время, повторы.
 * @param {PendingCycle[]} pending
 * @returns {string[]}
 */
function pendingMarkdown(pending) {
  /** @type {string[]} */
  const lines = ['## Незавершённые циклы', ''];

  if (pending.length === 0) {
    lines.push(
      `Незавершённых циклов нет: у каждого каталога со \`${FIXED_NAMES.state}\`` +
        ` есть \`${FIXED_NAMES.metrics}\`.`,
      '',
    );
    return lines;
  }

  lines.push(
    '| Цикл | Стадия | Статус | Итерация | Обновлён | Повторы REVIEW/EVALUATE/evidence |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const cycle of pending) {
    lines.push(
      `| ${cycle.name} | ${cycle.stage} | ${cycle.stage_status}` +
        ` | ${cycle.iteration}/${cycle.max_iterations} | ${cycle.updated_at}` +
        ` | ${cycle.retries.REVIEW}/${cycle.retries.EVALUATE}/${cycle.retries.evidence} |`,
    );
  }
  lines.push('');
  return lines;
}

/**
 * Блок «Почему остановились» в markdown. `fail`, `not_run` и `insufficient_data` — разные
 * строки: слить их в одну значило бы потерять причину.
 * @param {Stop[]} stops
 * @returns {string[]}
 */
function stopsMarkdown(stops) {
  /** @type {string[]} */
  const lines = ['## Почему остановились', ''];

  if (stops.length === 0) {
    lines.push('Циклов с решением или эскалацией нет: объяснять нечего.', '');
    return lines;
  }

  for (const stop of stops) {
    lines.push(`### ${stop.name}`, '', `- Вердикт: ${stop.action ?? NO_VALUE}`);
    if (stop.reasons.length > 0) lines.push(`- Причины: ${stop.reasons.join('; ')}`);
    if (stop.escalation !== null) {
      const detail = stop.escalation.detail === null ? '' : ` — ${stop.escalation.detail}`;
      lines.push(`- Эскалация: ${stop.escalation.reason}${detail}`);
    }
    if (stop.unverified.length > 0) lines.push(`- Непроверенное: ${stop.unverified.join('; ')}`);
    if (stop.criteria.length > 0) {
      lines.push(
        `- Критерии не met: ${stop.criteria.map((item) => `${item.id} ${item.status}`).join('; ')}`,
      );
    }

    const failed = stop.gates.filter((gate) => gate.status === 'fail');
    if (failed.length > 0) lines.push(`- Гейты fail: ${failed.map((gate) => gate.id).join(', ')}`);

    const notRun = stop.gates.filter((gate) => gate.status === 'not_run');
    if (notRun.length > 0) {
      lines.push(
        `- Гейты not_run: ${notRun
          .map((gate) => `${gate.id} (${gate.reason ?? 'причина не записана'})`)
          .join(', ')}`,
      );
    }

    if (stop.insufficient) {
      lines.push(
        `- insufficient_data: ${missingText(stop.missing)} — причину остановки взять не из чего`,
      );
    }
    lines.push('');
  }

  return lines;
}

/**
 * Отчёт в markdown: шапка с итогами, таблица циклов, таблица гейтов, незавершённые циклы
 * и причины остановки.
 * @param {Report} report
 * @returns {string}
 */
export function renderMarkdown(report) {
  const { cycles, pending, stops, cost, findings, skipped, gates } = report;
  /** @type {string[]} */
  const lines = ['# Отчёт по циклам', ''];

  lines.push(
    `Пропущено каталогов без \`${FIXED_NAMES.state}\` и \`${FIXED_NAMES.metrics}\`: ${skipped}.`,
    '',
  );

  if (cycles.length === 0) {
    lines.push('Циклов с `metrics.json` нет: собирать нечего.', '');
  } else {
    lines.push(
      `Циклов: ${cost.total}, с расходом: ${cost.measured}.` +
        ` Расход: ${rub(cost.sum)} ₽, медиана: ${rub(cost.median)} ₽.`,
      '',
      `Находок только у оценщика: ${findings.evaluator_only} из ${findings.total}` +
        ` (${percentText(findings.percent)}).`,
      '',
      '| Цикл | Стадия | Итераций | Время, с | Расход, ₽ | Input-токены | Доля кэша | Размер пакета | Рост evidence | Только оценщик | Только ревью | Оба | Дефекты оценщика B/M/m | Неразрешённые ссылки | Незакрытые этапы |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );

    for (const cycle of cycles) {
      const defects = cycle.evaluator_defects;
      lines.push(
        `| ${cycle.name} | ${cycle.final_stage} | ${cycle.iterations}/${cycle.max_iterations}` +
          ` | ${Math.round(cycle.duration_s)} | ${rub(cycle.cost_rub)}` +
          ` | ${tokensText(cycle.context.input)}` +
          ` | ${cacheText(cycle.context.cache_share, cycle.context.input !== null)}` +
          ` | ${evidenceText(cycle.context)} | ${growthText(cycle.context)}` +
          ` | ${cycle.findings.only_evaluator} | ${cycle.findings.only_review} | ${cycle.findings.both}` +
          ` | ${defects.BLOCKER}/${defects.MAJOR}/${defects.MINOR}` +
          ` | ${cycle.unresolved_refs} | ${cycle.unclosed_stages} |`,
      );
    }

    lines.push('', ...contextGapsMarkdown(cycles));

    const withStages = cyclesWithStages(cycles);
    if (withStages.length > 0) {
      lines.push('## Контекст по стадиям', '');
      lines.push('| Цикл | Стадия | Input-токены | Доля кэша |', '| --- | --- | --- | --- |');
      for (const cycle of withStages) {
        for (const stage of cycle.context.stages) {
          lines.push(
            `| ${cycle.name} | ${stage.stage} | ${stage.input} | ${cacheText(stage.cache_share, true)} |`,
          );
        }
      }
      lines.push('');
    }

    lines.push('', '## Исходы гейтов', '');
    if (gates.length === 0) {
      lines.push('Гейты в метриках не зафиксированы.', '');
    } else {
      lines.push('| Гейт | pass | fail | skipped | not_run |', '| --- | --- | --- | --- | --- |');
      for (const gate of gates) {
        lines.push(
          `| ${gate.id} | ${gate.pass} | ${gate.fail} | ${gate.skipped} | ${gate.not_run} |`,
        );
      }
      lines.push('');
    }
  }

  lines.push(...pendingMarkdown(pending), ...stopsMarkdown(stops));

  return lines.join('\n');
}

/**
 * Экранирует текст для HTML. Имена каталогов циклов и id гейтов приходят из файловой системы
 * и конфига проекта, то есть в общем случае недоверенные.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Доля от максимума в процентах — для ширины полоски расхода. Детерминированно: округление
 * до десятых, ноль знаменателя — ноль ширины.
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
export function barPercent(value, max) {
  if (!(max > 0)) return 0;
  return Math.round((value / max) * 1000) / 10;
}

/** Стили страницы: внутри документа, без внешних запросов. */
const HTML_STYLE = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 2rem 1.25rem 3rem; max-width: 72rem;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
h1 { margin: 0 0 1rem; font-size: 1.6rem; }
h2 { margin: 2rem 0 .75rem; font-size: 1.2rem; }
p { margin: .25rem 0; }
.lead { font-weight: 600; }
.muted { color: #6b7280; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; font-size: 14px; }
caption { text-align: left; padding-bottom: .4rem; color: #6b7280; }
th, td { border: 1px solid #d1d5db; padding: .35rem .5rem; text-align: right;
  font-variant-numeric: tabular-nums; white-space: nowrap; }
th:first-child, td:first-child, caption { text-align: left; }
td:first-child { white-space: normal; }
thead th { background: #f3f4f6; font-weight: 600; }
tbody tr:nth-child(even) { background: #fafafa; }
.bars { display: grid; grid-template-columns: minmax(10rem, 22rem) 1fr; gap: .3rem .8rem;
  align-items: center; margin: .5rem 0 1rem; }
.bars .label { overflow-wrap: anywhere; font-size: 14px; }
.track { background: #f3f4f6; border-radius: 3px; overflow: hidden; }
.fill { height: 1.1rem; background: #2563eb; min-width: 1px; }
.bars .value { grid-column: 2; font-size: 12px; color: #6b7280; margin: -.2rem 0 .3rem; }
.stop { margin: 0 0 1.25rem; padding: .1rem 0 .1rem .9rem; border-left: 3px solid #d1d5db; }
.stop h3 { margin: .4rem 0 .35rem; font-size: 1rem; }
.stop ul { margin: 0; padding-left: 1.1rem; }
.stop li { margin: .15rem 0; }
.insufficient { color: #b45309; font-weight: 600; }
@media (prefers-color-scheme: dark) {
  body { background: #111827; color: #e5e7eb; }
  th, td { border-color: #374151; }
  thead th, .track { background: #1f2937; }
  tbody tr:nth-child(even) { background: #0f172a; }
  .fill { background: #60a5fa; }
  .muted, .bars .value, caption { color: #9ca3af; }
  .stop { border-color: #374151; }
  .insufficient { color: #fbbf24; }
}`;

/**
 * Блок «Незавершённые циклы» в HTML: таблица или честная фраза, что таких нет.
 * @param {PendingCycle[]} pending
 * @returns {string[]}
 */
function pendingHtml(pending) {
  /** @type {string[]} */
  const body = ['<h2>Незавершённые циклы</h2>'];

  if (pending.length === 0) {
    body.push(
      '<p class="muted">Незавершённых циклов нет: у каждого каталога со ' +
        '<code>state.json</code> есть <code>metrics.json</code>.</p>',
    );
    return body;
  }

  body.push(
    '<table>',
    '<caption>Каталоги со <code>state.json</code> без <code>metrics.json</code></caption>',
    '<thead>',
    '<tr>',
  );
  for (const title of [
    'Цикл',
    'Стадия',
    'Статус',
    'Итерация',
    'Обновлён',
    'Повторы REVIEW/EVALUATE/evidence',
  ]) {
    body.push(`<th scope="col">${escapeHtml(title)}</th>`);
  }
  body.push('</tr>', '</thead>', '<tbody>');
  for (const cycle of pending) {
    const cells = [
      escapeHtml(cycle.name),
      escapeHtml(cycle.stage),
      escapeHtml(cycle.stage_status),
      `${cycle.iteration}/${cycle.max_iterations}`,
      escapeHtml(cycle.updated_at),
      `${cycle.retries.REVIEW}/${cycle.retries.EVALUATE}/${cycle.retries.evidence}`,
    ];
    body.push(`<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`);
  }
  body.push('</tbody>', '</table>');
  return body;
}

/**
 * Блок «Почему остановились» в HTML. Классы `fail`, `not-run` и `insufficient` — разные
 * строки списка: слить их в одну значило бы потерять причину.
 * @param {Stop[]} stops
 * @returns {string[]}
 */
function stopsHtml(stops) {
  /** @type {string[]} */
  const body = ['<h2>Почему остановились</h2>'];

  if (stops.length === 0) {
    body.push('<p class="muted">Циклов с решением или эскалацией нет: объяснять нечего.</p>');
    return body;
  }

  for (const stop of stops) {
    body.push(
      '<section class="stop">',
      `<h3>${escapeHtml(stop.name)}</h3>`,
      '<ul>',
      `<li><strong>Вердикт:</strong> ${escapeHtml(stop.action ?? NO_VALUE)}</li>`,
    );
    if (stop.reasons.length > 0) {
      body.push(`<li><strong>Причины:</strong> ${escapeHtml(stop.reasons.join('; '))}</li>`);
    }
    if (stop.escalation !== null) {
      const detail = stop.escalation.detail === null ? '' : ` — ${stop.escalation.detail}`;
      body.push(
        `<li><strong>Эскалация:</strong> ` +
          `${escapeHtml(`${stop.escalation.reason}${detail}`)}</li>`,
      );
    }
    if (stop.unverified.length > 0) {
      body.push(
        `<li><strong>Непроверенное:</strong> ${escapeHtml(stop.unverified.join('; '))}</li>`,
      );
    }
    if (stop.criteria.length > 0) {
      body.push(
        `<li class="criteria"><strong>Критерии не met:</strong> ` +
          `${escapeHtml(stop.criteria.map((item) => `${item.id} ${item.status}`).join('; '))}</li>`,
      );
    }

    const failed = stop.gates.filter((gate) => gate.status === 'fail');
    if (failed.length > 0) {
      body.push(
        `<li class="fail"><strong>Гейты fail:</strong> ` +
          `${escapeHtml(failed.map((gate) => gate.id).join(', '))}</li>`,
      );
    }

    const notRun = stop.gates.filter((gate) => gate.status === 'not_run');
    if (notRun.length > 0) {
      body.push(
        `<li class="not-run"><strong>Гейты not_run:</strong> ` +
          `${escapeHtml(
            notRun.map((gate) => `${gate.id} (${gate.reason ?? 'причина не записана'})`).join(', '),
          )}</li>`,
      );
    }

    if (stop.insufficient) {
      body.push(
        `<li class="insufficient"><strong>insufficient_data:</strong> ` +
          `${escapeHtml(missingText(stop.missing))} — причину остановки взять не из чего</li>`,
      );
    }
    body.push('</ul>', '</section>');
  }

  return body;
}

/**
 * Отчёт одной самодостаточной HTML-страницей (#45). Чистая функция: те же факты, что в
 * markdown, без времени, случайности и внешних ресурсов.
 * @param {Report} report
 * @returns {string}
 */
export function renderHtml(report) {
  const { cycles, pending, stops, cost, findings, skipped, gates } = report;
  /** @type {string[]} */
  const body = ['<h1>Отчёт по циклам</h1>'];

  body.push(
    '<p class="muted">Пропущено каталогов без <code>state.json</code> и ' +
      `<code>${escapeHtml(FIXED_NAMES.metrics)}</code>: ${skipped}.</p>`,
  );

  if (cycles.length === 0) {
    body.push('<p>Циклов с <code>metrics.json</code> нет: собирать нечего.</p>');
  } else {
    body.push(
      `<p class="lead">Циклов: ${cost.total}, с расходом: ${cost.measured}.` +
        ` Расход: ${rub(cost.sum)} ₽, медиана: ${rub(cost.median)} ₽.</p>`,
      `<p>Находок только у оценщика: ${findings.evaluator_only} из ${findings.total}` +
        ` (${percentText(findings.percent)}).</p>`,
    );

    const measured = cycles.filter((cycle) => cycle.cost_rub !== null);
    if (measured.length > 0) {
      const max = Math.max(...measured.map((cycle) => cycle.cost_rub ?? 0));
      body.push('<h2>Расход по циклам</h2>', '<div class="bars">');
      for (const cycle of measured) {
        const value = cycle.cost_rub ?? 0;
        body.push(
          `<div class="label">${escapeHtml(cycle.name)}</div>`,
          `<div class="track"><div class="fill" style="width: ${barPercent(value, max)}%"></div></div>`,
          `<div class="value">${rub(value)} ₽</div>`,
        );
      }
      body.push('</div>');
    }

    body.push(
      '<h2>Циклы</h2>',
      '<table>',
      '<caption>Факты по завершённым циклам</caption>',
      '<thead>',
      '<tr>',
    );
    for (const title of [
      'Цикл',
      'Стадия',
      'Итераций',
      'Время, с',
      'Расход, ₽',
      'Input-токены',
      'Доля кэша',
      'Размер пакета',
      'Рост evidence',
      'Только оценщик',
      'Только ревью',
      'Оба',
      'Дефекты оценщика B/M/m',
      'Неразрешённые ссылки',
      'Незакрытые этапы',
    ]) {
      body.push(`<th scope="col">${escapeHtml(title)}</th>`);
    }
    body.push('</tr>', '</thead>', '<tbody>');
    for (const cycle of cycles) {
      const defects = cycle.evaluator_defects;
      body.push(
        '<tr>' +
          [
            escapeHtml(cycle.name),
            escapeHtml(cycle.final_stage),
            `${cycle.iterations}/${cycle.max_iterations}`,
            `${Math.round(cycle.duration_s)}`,
            rub(cycle.cost_rub),
            tokensText(cycle.context.input),
            cacheText(cycle.context.cache_share, cycle.context.input !== null),
            evidenceText(cycle.context),
            growthText(cycle.context),
            `${cycle.findings.only_evaluator}`,
            `${cycle.findings.only_review}`,
            `${cycle.findings.both}`,
            `${defects.BLOCKER}/${defects.MAJOR}/${defects.MINOR}`,
            `${cycle.unresolved_refs}`,
            `${cycle.unclosed_stages}`,
          ]
            .map((cell) => `<td>${cell}</td>`)
            .join('') +
          '</tr>',
      );
    }
    body.push('</tbody>', '</table>');

    const withStages = cyclesWithStages(cycles);
    if (withStages.length > 0) {
      body.push(
        '<h2>Контекст по стадиям</h2>',
        '<table>',
        '<caption>Расход и доля кэша по этапам модели, по <code>context.tokens</code></caption>',
        '<thead>',
        '<tr>',
        '<th scope="col">Цикл</th><th scope="col">Стадия</th>' +
          '<th scope="col">Input-токены</th><th scope="col">Доля кэша</th>',
        '</tr>',
        '</thead>',
        '<tbody>',
      );
      for (const cycle of withStages) {
        for (const stage of cycle.context.stages) {
          body.push(
            `<tr><td>${escapeHtml(cycle.name)}</td><td>${escapeHtml(stage.stage)}</td>` +
              `<td>${stage.input}</td>` +
              `<td>${cacheText(stage.cache_share, true)}</td></tr>`,
          );
        }
      }
      body.push('</tbody>', '</table>');
    }

    const gaps = cycles.filter((cycle) => cycle.context.missing.length > 0);
    if (gaps.length > 0) {
      body.push('<p class="insufficient"><strong>Нечем мерить (insufficient_data):</strong>');
      for (const cycle of gaps) {
        body.push(
          `<br><code>${escapeHtml(cycle.name)}</code> — ${escapeHtml(cycle.context.missing.join(', '))}`,
        );
      }
      body.push('</p>');
    }

    body.push('<h2>Исходы гейтов</h2>');
    if (gates.length === 0) {
      body.push('<p>Гейты в метриках не зафиксированы.</p>');
    } else {
      body.push(
        '<table>',
        '<caption>Суммы по всем циклам отчёта</caption>',
        '<thead>',
        '<tr><th scope="col">Гейт</th><th scope="col">pass</th><th scope="col">fail</th>' +
          '<th scope="col">skipped</th><th scope="col">not_run</th></tr>',
        '</thead>',
        '<tbody>',
      );
      for (const gate of gates) {
        body.push(
          `<tr><td>${escapeHtml(gate.id)}</td><td>${gate.pass}</td><td>${gate.fail}</td>` +
            `<td>${gate.skipped}</td><td>${gate.not_run}</td></tr>`,
        );
      }
      body.push('</tbody>', '</table>');
    }
  }

  body.push(...pendingHtml(pending), ...stopsHtml(stops));

  return htmlPage('Отчёт по циклам', body);
}

/**
 * Каркас страницы: кодировка, стили, тело. Ни одного внешнего ресурса — иначе отчёт перестал
 * бы открываться без сети.
 * @param {string} title
 * @param {string[]} body
 * @returns {string}
 */
function htmlPage(title, body) {
  return [
    '<!doctype html>',
    '<html lang="ru">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${HTML_STYLE}</style>`,
    '</head>',
    '<body>',
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Разбирает аргументы командной строки. Любой мусор — ошибка использования (код 2).
 * @param {string[]} argv
 * @returns {{ dir: string|null, json: boolean, html: boolean }}
 */
export function parseArgs(argv) {
  /** @type {string|null} */
  let dir = null;
  let json = false;
  let html = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir') {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
        throw new Error('--dir: ожидается путь к каталогу артефактов');
      }
      dir = value;
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--html') {
      html = true;
      continue;
    }
    throw new Error(`неизвестный аргумент: ${arg}`);
  }

  // Два формата одного отчёта в одном stdout — противоречие; выбирает человек, а не порядок флагов.
  if (json && html) throw new Error('--json и --html взаимоисключающие: выберите один формат');

  return { dir, json, html };
}

/**
 * Точка входа CLI: печатает отчёт в stdout, на диск не пишет.
 * @returns {void}
 */
function main() {
  try {
    const cli = takeConfigOption(process.argv.slice(2));
    const args = parseArgs(cli.argv);
    const root = repoRoot();
    const config = loadConfig(root, { file: cli.file });
    const dir = args.dir === null ? artifactsDir(root, config) : resolve(args.dir);

    const names = listArtifactDirs(dir);
    /** @type {CycleSummary[]} */
    const cycles = [];
    /** @type {PendingCycle[]} */
    const pending = [];
    /** Состояния циклов: нужны как запасной источник причины эскалации. */
    /** @type {Map<string, Record<string, any>>} */
    const states = new Map();
    /** @type {string[]} */
    const stopNames = [];
    let skipped = 0;

    for (const name of names) {
      const cycleDir = join(dir, name);
      const statePath = join(cycleDir, FIXED_NAMES.state);

      if (existsSync(join(cycleDir, FIXED_NAMES.metrics))) {
        cycles.push(
          summarizeCycle(name, readArtifact(cycleDir, name, FIXED_NAMES.metrics, validateMetrics)),
        );
        if (existsSync(statePath)) {
          states.set(name, readArtifact(cycleDir, name, FIXED_NAMES.state, validateState));
        }
        stopNames.push(name);
        continue;
      }

      if (existsSync(statePath)) {
        const state = readArtifact(cycleDir, name, FIXED_NAMES.state, validateState);
        states.set(name, state);
        pending.push(summarizePending(name, state));
        // Эскалированный цикл без метрик тоже объясняет остановку: иначе причина живёт
        // только в `escalation.json`.
        if (state.stage === 'ESCALATED') stopNames.push(name);
        continue;
      }

      skipped += 1;
    }

    const stops = stopNames
      .sort()
      .map((name) =>
        summarizeStop(
          name,
          collectStopArtifacts(join(dir, name), name, { state: states.get(name) ?? null }),
        ),
      );

    const report = buildReport(cycles, {
      skipped,
      pending,
      stops,
      gateIds: config.gates.map((gate) => gate.id),
    });
    const output = args.html
      ? renderHtml(report)
      : args.json
        ? `${JSON.stringify(report)}\n`
        : renderMarkdown(report);
    process.stdout.write(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cycle-report: ${message}\n`);
    process.exitCode = 2;
  }
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) main();
