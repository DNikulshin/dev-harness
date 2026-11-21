#!/usr/bin/env node
/**
 * Сводка `metrics.json` по циклам (docs/orchestrator.md §11, §15).
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
 * **Отчёт — представление прогона (#114).** Первичный контракт — `--json`: объект с фактами и
 * блоком `source { dir, cycles_read, cycles_skipped, core { version, revision } }`. Откуда снят
 * отчёт, сколько каталогов прочитано и сколько пропущено, каким ядром (`package.json#version`,
 * `git rev-parse HEAD`) — всё это факты, которые нельзя подделать, не соврав в счётчиках:
 * `cycles_read + cycles_skipped` = число подкаталогов каталога артефактов. Markdown и `--html`
 * собираются из того же объекта (`renderMarkdown`/`renderHtml` берут `Report`), второго
 * источника правды нет, и печатная шапка повторяет блок `source` строкой «факт — прогон,
 * а не текст»: присланную сводку сверяют `--json`-выводом, а не доверием к виду таблицы.
 * Ревизии нет (вне git, пустой репозиторий) — `null` в JSON и прочерк в шапке: догадка вместо
 * факта в происхождение не попадает. `source` не зависит от времени, как и остальной отчёт.
 *
 * **`--html` (#45).** Тот же отчёт одной самодостаточной страницей: стили внутри, без внешних
 * ресурсов и без JS — файл открывается с диска и в сеть не ходит (`> report.html` делает
 * человек, поэтому контракт «ничего не пишет на диск» сохраняется). Модель отчёта общая с
 * markdown: `renderHtml` и `renderMarkdown` берут один `Report`, второго источника правды нет.
 * Ширина полоски расхода — доля от максимума в отчёте, число подписано рядом; всё считается
 * из данных, поэтому два запуска дают побайтно одинаковую страницу.
 *
 * **«Не проверено» (#115).** Сводка отвечает, сколько решений принято без проверки:
 * число `PROCEED_WITH_UNVERIFIED` и его доля от решений, рядом — `REWORK` и `ESCALATE`, плюс
 * сколько пунктов осталось владельцу (сумма, медиана, максимум) и из чего они пришли —
 * разрезом по источникам (#137): гейты `not_run`, понижения `unproven:`, критерии без статуса
 * `criteria:<id> missing`, прочее. Разрез полный: сумма четырёх групп равна числу пунктов.
 * Колонка «Не проверено» — число пунктов на цикл. Источник — `decision.unverified[]` и
 * `evaluation.unverified[]`, дедуплицированные общим правилом (`lib/cycle/unverified.mjs`): один факт из двух артефактов считается один раз. Гейты `skipped` (условие проекта
 * не применимо) в это число не входят — только `not_run`; в таблице гейтов они и раньше шли
 * разными колонками. Нет `decision.<n>.json` — в ячейке и в сводке `insufficient_data`
 * с именем цикла, а не ноль: решение о пороге не должно опираться на выданный за факт ноль.
 *
 * **Дифф и провалы проверок (#120, ADR 0010).** Два факта для решения о verification tax
 * читаются из уже существующих артефактов, схема не меняется: размер `evidence/diff.patch` и
 * рост к предыдущей измеренной итерации — из `manifest.<n>.json` (там уже есть `files[]` и
 * `totals`), провалы — из `gates.<n>.json` только по обязательным (`required: true`).
 * Кумулятивный дифф от `base_sha` — то, что лежит в пакете; дельта итерации — производное число,
 * отдельным замером не становится. Нет снимка или файла гейтов — `insufficient_data` и перечень
 * «нечем мерить», а не ноль: выдуманный ноль в решении о пороге неотличим от «всё прошло».
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
import { headRevision } from './lib/cycle/git.mjs';
import { readJson } from './lib/cycle/io.mjs';
import { FIXED_NAMES, artifactsDir, repoRoot } from './lib/cycle/paths.mjs';
import { dedupeUnverified, unverifiedSource } from './lib/cycle/unverified.mjs';
import {
  validateDecision,
  validateEscalation,
  validateEvaluation,
  validateGates,
  validateManifest,
  validateMetrics,
  validateState,
} from './lib/cycle/validate.mjs';

/** Серьёзности дефектов оценщика (Приложение A). */
const DEFECT_SEVERITIES = Object.freeze(['BLOCKER', 'MAJOR', 'MINOR']);

/** Статусы гейта (§5.5) — по ним ведутся исходы. */
const GATE_STATUSES = Object.freeze(['pass', 'fail', 'skipped', 'not_run']);

/** Действия `decision.<n>.json` (§5.6) в порядке схемы: по нему печатаются вердикты. */
const DECISION_ACTIONS = Object.freeze([
  'REWORK',
  'ACQUIRE_EVIDENCE',
  'RETRY_STAGE',
  'PROCEED',
  'PROCEED_WITH_UNVERIFIED',
  'ESCALATE',
]);

/** Действие решения, которым цикл принят без проверки (#115). */
const PROCEED_WITH_UNVERIFIED = 'PROCEED_WITH_UNVERIFIED';

/**
 * Действия, которые печатаются в сводке всегда: доля принятых без проверки и то, с чем её
 * сравнивают при принятии решения о пороге (`verification_tax`, #116). Остальные действия
 * появляются только когда они были.
 */
const VERDICTS_SHOWN = Object.freeze(['PROCEED_WITH_UNVERIFIED', 'REWORK', 'ESCALATE']);

/** Завершённые циклы: по ним считается доля вердиктов (#115). */
const COMPLETED_STAGES = Object.freeze(['DONE', 'ESCALATED']);

/** Нет данных: в ячейке честная прочерк, а не ноль. */
const NO_VALUE = '—';

/**
 * Нет замера: в ячейке — явное «мерить нечем», а не ноль и не прочерк. Прочерк значал бы
 * «вопрос не применим», а здесь именно отсутствие данных (ADR 0009).
 */
const INSUFFICIENT = 'insufficient_data';

/** Блок `context` в `metrics.json` ещё не писался: старые артефакты до #107. */
const REASON_NO_CONTEXT = 'нет блока context в metrics.json';

/** Файл диффа в пакете `evidence/`: его размер и есть «размер диффа» (#120, ADR 0010). */
const DIFF_PATH = 'evidence/diff.patch';

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
 * Проверено ли решение: что осталось непроверенным (#115).
 * @typedef {object} CycleVerification
 * @property {string|null} action действие `decision.<n>.json`; `null` — решения нет
 * @property {number|null} items пунктов «не проверено» после дедупликации; `null` — считать не из чего
 * @property {number|null} gate_not_run из пунктов — гейты `not_run`
 * @property {number|null} unproven из пунктов — понижения `unproven:` (#125)
 * @property {number|null} criteria_missing из пунктов — критерии без статуса `criteria:<id> missing` (#124)
 * @property {number|null} other из пунктов — остальные источники (оценщик, ревью, QA, integrity)
 */

/**
 * Размер диффа по итерациям из `manifest.<n>.json` (#120, ADR 0010).
 * @typedef {object} CycleDiff
 * @property {number|null} iteration номер последней измеренной итерации
 * @property {number|null} bytes байт `evidence/diff.patch` той итерации
 * @property {number|null} lines строк того же файла
 * @property {number|null} growth отношение к предыдущей измеренной итерации по строкам
 * @property {number} measured сколько итераций с измеренным диффом
 * @property {string[]} missing чего не хватает, чтобы измерить
 */

/**
 * Провалы обязательных гейтов (#120, ADR 0010): `skipped` — не провал, а отдельный факт.
 * @typedef {object} CycleChecks
 * @property {number} fail обязательных гейтов в `fail`
 * @property {number} not_run обязательных гейтов в `not_run`
 * @property {number} skipped обязательных гейтов в `skipped` (условие проекта)
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
 * @property {CycleVerification|null} [verification] решение и «не проверено» (#115)
 * @property {CycleDiff} [diff] дифф по итерациям и его рост (#120)
 * @property {CycleChecks|null} [checks] провалы обязательных гейтов; `null` — нет `gates.<n>.json`
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
 * Вердикты и «не проверено» по всем циклам отчёта (#115).
 * @typedef {object} VerificationSummary
 * @property {number} completed завершённых циклов (`DONE`/`ESCALATED`)
 * @property {number} decided из них с решением
 * @property {string[]} missing циклы без `decision.<n>.json`: вердикт и число пунктов неизвестны
 * @property {Record<string, number>} actions счётчики по действиям §5.6
 * @property {number|null} proceed_with_unverified_share доля принятых без проверки от решений
 * @property {number} measured циклов с посчитанным числом пунктов
 * @property {number|null} items_total пунктов всего
 * @property {number|null} items_median медиана пунктов на цикл
 * @property {number|null} items_max максимум пунктов на цикл
 * @property {number|null} gate_not_run из пунктов — гейты `not_run`; `null` — считать не из чего
 * @property {number|null} unproven из пунктов — понижения `unproven:` (#125)
 * @property {number|null} criteria_missing из пунктов — критерии без статуса (#124)
 * @property {number|null} other из пунктов — остальные источники
 */

/**
 * Дифф и провалы гейтов по всем циклам отчёта (#120, ADR 0010).
 * @typedef {object} DiffFacts
 * @property {number} measured циклов с измеренным диффом
 * @property {number|null} lines_median медиана строк диффа на цикл
 * @property {number|null} lines_max максимум строк
 * @property {number|null} growth_median медиана роста к предыдущей итерации
 * @property {string[]} unmeasured циклы, у которых мерить нечем
 */

/**
 * @typedef {object} CheckFacts
 * @property {number} measured циклов, у которых есть `gates.<n>.json`
 * @property {number} failing из них с провалом обязательного гейта (`fail` или `not_run`)
 * @property {number} fail_total обязательных гейтов в `fail`
 * @property {number} not_run_total обязательных гейтов в `not_run`
 * @property {number} skipped_total обязательных гейтов в `skipped` (не провал)
 * @property {string[]} unmeasured циклы без `gates.<n>.json`
 */

/**
 * @typedef {object} ReportSource
 * @property {string|null} dir абсолютный каталог артефактов, из которого снят отчёт
 * @property {number} cycles_read прочитано каталогов цикла (`state.json` или `metrics.json`)
 * @property {number} cycles_skipped пропущено каталогов: нет ни `state.json`, ни `metrics.json`
 * @property {{ version: string|null, revision: string|null }} core ядро: версия и ревизия
 */

/**
 * @typedef {object} Report
 * @property {ReportSource} source происхождение отчёта (#114)
 * @property {CycleSummary[]} cycles
 * @property {PendingCycle[]} pending каталоги со `state.json` без `metrics.json`
 * @property {Stop[]} stops почему остановились циклы (завершённые и эскалированные)
 * @property {{ measured: number, total: number, sum: number|null, median: number|null }} cost
 * @property {{ evaluator_only: number, total: number, percent: number|null }} findings
 * @property {VerificationSummary} verification вердикты и «не проверено» (#115)
 * @property {DiffFacts} diff дифф по итерациям (#120)
 * @property {CheckFacts} checks провалы обязательных гейтов (#120)
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
function gapsMarkdown(cycles) {
  const gaps = cycles
    .map((cycle) => ({ name: cycle.name, missing: cycleGaps(cycle) }))
    .filter((entry) => entry.missing.length > 0);
  if (gaps.length === 0) return [];

  /** @type {string[]} */
  const lines = ['Нечем мерить (insufficient_data):'];
  for (const gap of gaps) {
    lines.push(`- \`${gap.name}\` — ${gap.missing.join(', ')}`);
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
 * Версия ядра из `package.json` рядом с `scripts/`. Нет файла или поля — `null`:
 * в шапке отчёта это «неизвестно», а не `0.0.0` и не версия на глаз.
 * @param {string} root корень ядра
 * @returns {string|null}
 */
export function coreVersion(root) {
  /** @type {unknown} */
  let doc;
  try {
    doc = readJson(join(root, 'package.json'));
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== 'object') return null;
  const version = /** @type {Record<string, unknown>} */ (doc).version;
  return typeof version === 'string' && version !== '' ? version : null;
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
  const files = iterationFiles(cycleDir, base);
  return files.at(-1) ?? null;
}

/**
 * Все файлы итерации `base.<n>.json` в каталоге цикла по возрастанию номера. Перебор не зависит
 * от порядка `readdir`: сортировка по числу, а не по строке — иначе `manifest.10.json` встал бы
 * перед `manifest.2.json` и рост считался бы от чужой итерации.
 * @param {string} cycleDir каталог цикла
 * @param {string} base имя без номера и расширения (`manifest`, `gates`, …)
 * @returns {{ iteration: number, fileName: string }[]}
 */
export function iterationFiles(cycleDir, base) {
  const pattern = new RegExp(`^${base}\\.(\\d+)\\.json$`, 'u');
  /** @type {{ iteration: number, fileName: string }[]} */
  const files = [];
  for (const fileName of readdirSync(cycleDir)) {
    const match = pattern.exec(fileName);
    if (match === null) continue;
    files.push({ iteration: Number(match[1]), fileName });
  }
  return files.sort((left, right) => left.iteration - right.iteration);
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
 * Что осталось непроверенным в цикле (#115). Чистая функция: файлов не читает.
 *
 * Два источника одного списка (§5.6–5.7): `decision.unverified[]` (строки, в том числе
 * `gate:<id> not_run`, `criteria:<id> unverified` и копия `evaluation unverified: <what>`)
 * и `evaluation.unverified[]` (объекты `{what, why}`). Один факт приходит двумя формулировками,
 * поэтому перед счётом они дедуплицируются тем же правилом, что и в теле PR: иначе
 * число «сколько осталось владельцу» было бы больше, чем есть.
 *
 * Нет `decision.<n>.json` — `null`, а не ноль: «нечего считать» и «всё проверено» — разные
 * факты, и решение о пороге (`verification_tax`) не должно опираться на выданный за факт ноль.
 *
 * Число пунктов разложено по источникам (#137, `UNVERIFIED_SOURCES`): гейт, понижение, критерий
 * без статуса и остальное. Разрез полный и взаимоисключающий, поэтому сумма четырёх групп равна
 * `items` — это позволяет сравнивать базы разных версий ядра, где состав списка менялся (#124,
 * #125, ADR 0012).
 * @param {ReturnType<typeof collectStopArtifacts>} artifacts артефакты цикла
 * @returns {CycleVerification}
 */
export function summarizeVerification(artifacts) {
  const { decision, evaluation } = artifacts;
  if (decision === null)
    return {
      action: null,
      items: null,
      gate_not_run: null,
      unproven: null,
      criteria_missing: null,
      other: null,
    };

  const fromDecision = Array.isArray(decision.unverified) ? decision.unverified : [];
  const fromEvaluation =
    evaluation === null || !Array.isArray(evaluation.unverified)
      ? []
      : evaluation.unverified.map((item) => item.what);
  const items = dedupeUnverified([...fromDecision, ...fromEvaluation]);

  /** @type {Record<ReturnType<typeof unverifiedSource>, number>} */
  const sources = { gate: 0, unproven: 0, criteria_missing: 0, other: 0 };
  for (const item of items) sources[unverifiedSource(item)] += 1;

  return {
    action: decision.action,
    items: items.length,
    gate_not_run: sources.gate,
    unproven: sources.unproven,
    criteria_missing: sources.criteria_missing,
    other: sources.other,
  };
}

/**
 * Вердикты и «не проверено» по всем циклам (#115). Чистая функция.
 *
 * Знаменатель доли — **решения**, а не каталоги: цикл без `decision.<n>.json` не голосует
 * «за», но и не пропадает — он в `missing`. Сумма счётчиков действий равна `decided`, поэтому
 * подменить одну цифру, не соврав в сумме, нельзя.
 *
 * Разрез по источникам суммируется в `items_total` и живёт рядом с ним (#137): сумма, медиана
 * и доля решений без проверки на новом определении `items` (ADR 0012) между базами несопоставимы,
 * а разрез — сопоставим. Нет измеренных циклов — `null` во всех полях разреза, а не нули.
 * @param {CycleSummary[]} cycles
 * @returns {VerificationSummary}
 */
export function summarizeVerdicts(cycles) {
  /** @type {Record<string, number>} */
  const actions = Object.fromEntries(DECISION_ACTIONS.map((action) => [action, 0]));
  /** @type {string[]} */
  const missing = [];
  let completed = 0;
  let decided = 0;

  for (const cycle of cycles) {
    const verification = cycle.verification ?? null;
    if (verification === null || verification.action === null) missing.push(cycle.name);

    const finished = COMPLETED_STAGES.includes(cycle.final_stage);
    if (finished) completed += 1;
    if (!finished || verification === null || verification.action === null) continue;

    decided += 1;
    actions[verification.action] = (actions[verification.action] ?? 0) + 1;
  }

  const measured = cycles.filter((cycle) => (cycle.verification?.items ?? null) !== null);
  const items = measured.map((cycle) => cycle.verification?.items ?? 0);

  /**
   * Сумма одного источника по измеренным циклам. Нет измеренных — `null`, а не ноль: ноль
   * означал бы «всё проверено», а это другой факт.
   * @param {'gate_not_run'|'unproven'|'criteria_missing'|'other'} field поле разреза
   * @returns {number|null}
   */
  const sourceTotal = (field) =>
    measured.length === 0
      ? null
      : measured.reduce((sum, cycle) => sum + (cycle.verification?.[field] ?? 0), 0);

  return {
    completed,
    decided,
    missing,
    actions,
    proceed_with_unverified_share: percent(actions[PROCEED_WITH_UNVERIFIED] ?? 0, decided),
    measured: measured.length,
    items_total: measured.length === 0 ? null : items.reduce((sum, value) => sum + value, 0),
    items_median: median(items),
    items_max: items.length === 0 ? null : Math.max(...items),
    gate_not_run: sourceTotal('gate_not_run'),
    unproven: sourceTotal('unproven'),
    criteria_missing: sourceTotal('criteria_missing'),
    other: sourceTotal('other'),
  };
}

/**
 * Размер диффа по итерациям (#120, ADR 0010).
 *
 * Источник — `manifest.<n>.json` (#106): `files[]` уже содержит `evidence/diff.patch` с `bytes` и
 * `lines`. Новый снимок не нужен: это тот же файл, который ушёл оценщику.
 *
 * Дифф в пакете **кумулятивный** — от `base_sha` до `HEAD` итерации. Поэтому рост — отношение
 * последней измеренной итерации к предыдущей измеренной по строкам (той же единице, что в
 * колонке); дельта итерации — производное число и отдельным замером не становится. Одна
 * измеренная итерация роста не даёт — `null`, а не единица: «не с чем сравнивать» и «не изменилось»
 * — разные факты (то же правило, что у `evidence_growth`, ADR 0009).
 * @param {string} cycleDir каталог цикла
 * @param {string} cycleName имя каталога цикла
 * @returns {CycleDiff}
 */
export function summarizeDiff(cycleDir, cycleName) {
  const files = iterationFiles(cycleDir, 'manifest');
  /** @type {{ iteration: number, bytes: number, lines: number }[]} */
  const measured = [];
  /** @type {string[]} */
  const missing = [];
  if (files.length === 0) missing.push('manifest.<n>.json');

  for (const { iteration, fileName } of files) {
    const manifest = readArtifact(cycleDir, cycleName, fileName, validateManifest);
    /** @type {{ path: string, bytes: number, lines: number }[]} */
    const entries = manifest.files;
    const entry = entries.find((item) => item.path === DIFF_PATH);
    if (entry === undefined) {
      missing.push(`${fileName}: нет ${DIFF_PATH}`);
      continue;
    }
    measured.push({ iteration, bytes: entry.bytes, lines: entry.lines });
  }

  const last = measured.at(-1) ?? null;
  const previous = measured.length < 2 ? null : (measured.at(-2) ?? null);

  return {
    iteration: last === null ? null : last.iteration,
    bytes: last === null ? null : last.bytes,
    lines: last === null ? null : last.lines,
    growth:
      last === null || previous === null || previous.lines <= 0
        ? null
        : round3(last.lines / previous.lines),
    measured: measured.length,
    missing,
  };
}

/**
 * Провалы обязательных гейтов (#120, ADR 0010). Чистая функция: файлов не читает.
 *
 * Считаются только гейты `required: true` — необязательный гейт в `fail` ничего не блокировал.
 * `skipped` (условие проекта не применимо) — не провал, а отдельный факт: то же различение, что
 * в #115. Нет `gates.<n>.json` — `null`, а не нули: «нечего считать» и «всё прошло» — разные
 * факты, и решение о пороге не должно опираться на выданный за факт ноль.
 * @param {ReturnType<typeof collectStopArtifacts>} artifacts артефакты цикла
 * @returns {CycleChecks|null}
 */
export function summarizeChecks(artifacts) {
  const gates = artifacts.gates;
  if (gates === null) return null;

  /** @type {{ id: string, required: boolean, status: string }[]} */
  const rows = gates.gates;
  const required = rows.filter((gate) => gate.required === true);
  const countOf = (/** @type {string} */ status) =>
    required.filter((gate) => gate.status === status).length;

  return { fail: countOf('fail'), not_run: countOf('not_run'), skipped: countOf('skipped') };
}

/**
 * Дифф по всем циклам отчёта: агрегаты и перечень «мерить нечем» (#120).
 * @param {CycleSummary[]} cycles
 * @returns {DiffFacts}
 */
export function summarizeDiffFacts(cycles) {
  const measured = cycles.filter((cycle) => (cycle.diff?.lines ?? null) !== null);
  const lines = measured.map((cycle) => cycle.diff?.lines ?? 0);
  const growth = measured
    .map((cycle) => cycle.diff?.growth ?? null)
    .filter((value) => value !== null);

  return {
    measured: measured.length,
    lines_median: median(lines),
    lines_max: lines.length === 0 ? null : Math.max(...lines),
    growth_median: median(growth),
    unmeasured: cycles
      .filter((cycle) => (cycle.diff?.lines ?? null) === null)
      .map((cycle) => cycle.name),
  };
}

/**
 * Провалы обязательных гейтов по всем циклам (#120): сколько циклов с провалом и сколько
 * самих провалов, с `skipped` отдельно.
 * @param {CycleSummary[]} cycles
 * @returns {CheckFacts}
 */
export function summarizeCheckFacts(cycles) {
  const measured = cycles.filter((cycle) => (cycle.checks ?? null) !== null);
  const totals = { fail: 0, not_run: 0, skipped: 0 };
  let failing = 0;

  for (const cycle of measured) {
    const checks = cycle.checks ?? { fail: 0, not_run: 0, skipped: 0 };
    totals.fail += checks.fail;
    totals.not_run += checks.not_run;
    totals.skipped += checks.skipped;
    if (checks.fail + checks.not_run > 0) failing += 1;
  }

  return {
    measured: measured.length,
    failing,
    fail_total: totals.fail,
    not_run_total: totals.not_run,
    skipped_total: totals.skipped,
    unmeasured: cycles
      .filter((cycle) => (cycle.checks ?? null) === null)
      .map((cycle) => cycle.name),
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
 *
 * `cycles_read` не параметр, а следствие: прочитанные каталоги — это ровно те, что дали
 * `cycles` и `pending`. Принимать его числом значило бы разрешить отчёту разойтись
 * со своим же содержимым.
 * @param {CycleSummary[]} cycles сводки по циклам (в порядке отчёта)
 * @param {{
 *   skipped?: number,
 *   gateIds?: readonly string[],
 *   pending?: PendingCycle[],
 *   stops?: Stop[],
 *   source?: { dir?: string|null, core?: { version?: string|null, revision?: string|null } },
 * }} [options]
 *   `skipped` — каталоги без `state.json` и `metrics.json`; `source.dir` и `source.core` —
 *   происхождение, известное только CLI (без них — `null`, т. е. «неизвестно»)
 * @returns {Report}
 */
export function buildReport(
  cycles,
  { skipped = 0, gateIds = [], pending = [], stops = [], source = {} } = {},
) {
  const costs = cycles.map((cycle) => cycle.cost_rub).filter((value) => value !== null);
  const evaluatorOnly = cycles.reduce((sum, cycle) => sum + cycle.findings.only_evaluator, 0);
  const totalFindings = cycles.reduce(
    (sum, cycle) =>
      sum + cycle.findings.only_review + cycle.findings.only_evaluator + cycle.findings.both,
    0,
  );

  return {
    source: {
      dir: source.dir ?? null,
      cycles_read: cycles.length + pending.length,
      cycles_skipped: skipped,
      core: {
        version: source.core?.version ?? null,
        revision: source.core?.revision ?? null,
      },
    },
    cycles,
    pending,
    stops,
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
    verification: summarizeVerdicts(cycles),
    diff: summarizeDiffFacts(cycles),
    checks: summarizeCheckFacts(cycles),
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
 * Ячейка «Не проверено»: пунктов на цикл. `insufficient_data` — нет `decision.<n>.json`:
 * писать здесь `0` значило бы выдать «нечего считать» за «всё проверено» (#115).
 * @param {CycleVerification|null|undefined} verification
 * @returns {string}
 */
function unverifiedText(verification) {
  if (verification === null || verification === undefined || verification.items === null) {
    return INSUFFICIENT;
  }
  return String(verification.items);
}

/**
 * Действия с счётом для печати: сначала названные в §11 (в этом порядке — доля принятых
 * без проверки первая), затем остальные, если они были. Действие без счёта не печатается:
 * список из шести нулей читать незачем.
 * @param {VerificationSummary} verification
 * @returns {{ action: string, count: number }[]}
 */
function verdictCounts(verification) {
  const rest = DECISION_ACTIONS.filter(
    (action) => !VERDICTS_SHOWN.includes(action) && (verification.actions[action] ?? 0) > 0,
  );
  return [...VERDICTS_SHOWN, ...rest].map((action) => ({
    action,
    count: verification.actions[action] ?? 0,
  }));
}

/**
 * Вердикты одной строкой: `PROCEED_WITH_UNVERIFIED 3 из 5 (60.0% решений), REWORK 1, …`.
 * Чистый текст без разметки — markdown и `--html` подставляют свою.
 * @param {VerificationSummary} verification
 * @returns {{ action: string, count: number, share: number|null }[]}
 */
function verdictNumbers(verification) {
  return verdictCounts(verification).map(({ action, count }) => ({
    action,
    count,
    share: action === PROCEED_WITH_UNVERIFIED ? verification.proceed_with_unverified_share : null,
  }));
}

/**
 * Разрез «не проверено» по источникам одной строкой (#137): сумма групп равна `items_total`.
 * @param {VerificationSummary} verification
 * @returns {string}
 */
function sourcesText(verification) {
  return (
    `из них гейты \`not_run\`: ${verification.gate_not_run},` +
    ` понижения \`unproven:\`: ${verification.unproven},` +
    ` критерии без статуса \`missing\`: ${verification.criteria_missing},` +
    ` прочие источники: ${verification.other}`
  );
}

/**
 * Строки сводки markdown про вердикты и «не проверено» (#115).
 * @param {VerificationSummary} verification
 * @returns {string[]}
 */
function verificationMarkdown(verification) {
  const { completed, decided, missing, measured } = verification;
  const lines = [
    `Завершённых циклов (\`DONE\`/\`ESCALATED\`): ${completed}, с решением: ${decided}.`,
  ];

  if (decided === 0) {
    lines.push('Вердиктов нет: считать долю принятых без проверки не из чего.');
  } else {
    const verdicts = verdictNumbers(verification)
      .map(({ action, count, share }) =>
        share === null
          ? `\`${action}\` ${count}`
          : `\`${action}\` ${count} (${percentText(share)})`,
      )
      .join(', ');
    lines.push(`Вердикты: ${verdicts}.`);
  }

  if (measured === 0) {
    lines.push(`Пунктов «не проверено»: ${INSUFFICIENT} — решений нет, считать не из чего.`);
  } else {
    lines.push(
      `Пунктов «не проверено»: ${verification.items_total}` +
        ` (медиана ${verification.items_median}, максимум ${verification.items_max};` +
        ` ${sourcesText(verification)}).`,
    );
    lines.push(
      'Сумма, медиана и доля посчитаны на определении `items` после #124/#125: с базой 17 циклов' +
        ' ADR 0010 сравнимы только разрезы по источникам, не сумма (ADR 0012).',
    );
  }

  if (missing.length > 0) {
    lines.push(
      `Нет \`decision.<n>.json\`: ${missing.join(', ')} — вердикт и число пунктов неизвестны.`,
    );
  }

  return lines;
}

/**
 * Строки сводки `--html` про вердикты и «не проверено»: те же числа, что в markdown.
 * @param {VerificationSummary} verification
 * @returns {string[]}
 */
function verificationHtml(verification) {
  const { completed, decided, missing, measured } = verification;
  const lines = [
    `<p>Завершённых циклов (<code>DONE</code>/<code>ESCALATED</code>): ${completed},` +
      ` с решением: ${decided}.</p>`,
  ];

  if (decided === 0) {
    lines.push('<p>Вердиктов нет: считать долю принятых без проверки не из чего.</p>');
  } else {
    const verdicts = verdictNumbers(verification)
      .map(({ action, count, share }) =>
        share === null
          ? `<code>${escapeHtml(action)}</code> ${count}`
          : `<code>${escapeHtml(action)}</code> ${count} (${percentText(share)})`,
      )
      .join(', ');
    lines.push(`<p>Вердикты: ${verdicts}.</p>`);
  }

  if (measured === 0) {
    lines.push(
      `<p>Пунктов «не проверено»: ${escapeHtml(INSUFFICIENT)} — решений нет, считать не из чего.</p>`,
    );
  } else {
    lines.push(
      `<p>Пунктов «не проверено»: ${verification.items_total}` +
        ` (медиана ${verification.items_median}, максимум ${verification.items_max};` +
        ` из них гейты <code>not_run</code>: ${verification.gate_not_run},` +
        ` понижения <code>unproven:</code>: ${verification.unproven},` +
        ` критерии без статуса <code>missing</code>: ${verification.criteria_missing},` +
        ` прочие источники: ${verification.other}).</p>`,
    );
    lines.push(
      '<p>Сумма, медиана и доля посчитаны на определении <code>items</code> после #124/#125:' +
        ' с базой 17 циклов ADR 0010 сравнимы только разрезы по источникам, не сумма (ADR 0012).</p>',
    );
  }

  if (missing.length > 0) {
    lines.push(
      `<p class="insufficient">Нет <code>decision.&lt;n&gt;.json</code>: ` +
        `${escapeHtml(missing.join(', '))} — вердикт и число пунктов неизвестны.</p>`,
    );
  }

  return lines;
}

/**
 * Ячейка «Дифф, строк»: размер `evidence/diff.patch` последней измеренной итерации.
 * @param {CycleDiff|null|undefined} diff
 * @returns {string}
 */
function diffText(diff) {
  if (diff === null || diff === undefined || diff.lines === null || diff.bytes === null) {
    return INSUFFICIENT;
  }
  return `${diff.lines} (${sizeText(diff.bytes)})`;
}

/**
 * Рост в виде `×1.2`: `null` — прочерк, «сравнивать не с чем».
 * @param {number|null} value
 * @returns {string}
 */
function growthValueText(value) {
  return value === null ? NO_VALUE : `×${value}`;
}

/**
 * Ячейка «Рост диффа»: последняя измеренная итерация к предыдущей. Одна итерация роста не даёт.
 * @param {CycleDiff|null|undefined} diff
 * @returns {string}
 */
function diffGrowthText(diff) {
  if (diff === null || diff === undefined || diff.lines === null) return INSUFFICIENT;
  return growthValueText(diff.growth);
}

/**
 * Ячейка «Провалы проверок»: обязательные гейты `fail`/`not_run` в виде `fail/not_run`.
 * `skipped` не входит: условие проекта не применимо — не провал (ADR 0010).
 * @param {CycleChecks|null|undefined} checks
 * @returns {string}
 */
function checksText(checks) {
  if (checks === null || checks === undefined) return INSUFFICIENT;
  return `${checks.fail}/${checks.not_run}`;
}

/**
 * Строки сводки markdown про дифф и провалы обязательных гейтов (#120).
 * @param {DiffFacts} diff
 * @param {CheckFacts} checks
 * @returns {string[]}
 */
function diffAndChecksMarkdown(diff, checks) {
  /** @type {string[]} */
  const lines = [];

  if (checks.measured === 0) {
    lines.push(`Провалы обязательных гейтов: ${INSUFFICIENT} — нет \`gates.<n>.json\`.`);
  } else {
    lines.push(
      `Провалы обязательных гейтов: циклов с провалом — ${checks.failing} из ${checks.measured}` +
        ` (fail ${checks.fail_total}, not_run ${checks.not_run_total};` +
        ` skipped ${checks.skipped_total} — не провал).`,
    );
  }

  if (diff.measured === 0) {
    lines.push(`Дифф: ${INSUFFICIENT} — нет \`manifest.<n>.json\`.`);
  } else {
    lines.push(
      `Дифф: медиана ${diff.lines_median}, максимум ${diff.lines_max} строк` +
        ` (замеров: ${diff.measured}); рост — медиана ${growthValueText(diff.growth_median)}.`,
    );
  }

  return lines;
}

/**
 * Те же числа для `--html`.
 * @param {DiffFacts} diff
 * @param {CheckFacts} checks
 * @returns {string[]}
 */
function diffAndChecksHtml(diff, checks) {
  /** @type {string[]} */
  const lines = [];

  if (checks.measured === 0) {
    lines.push(
      `<p>Провалы обязательных гейтов: ${escapeHtml(INSUFFICIENT)} — нет` +
        ' <code>gates.&lt;n&gt;.json</code>.</p>',
    );
  } else {
    lines.push(
      `<p>Провалы обязательных гейтов: циклов с провалом — ${checks.failing} из ${checks.measured}` +
        ` (fail ${checks.fail_total}, not_run ${checks.not_run_total};` +
        ` skipped ${checks.skipped_total} — не провал).</p>`,
    );
  }

  if (diff.measured === 0) {
    lines.push(
      `<p>Дифф: ${escapeHtml(INSUFFICIENT)} — нет <code>manifest.&lt;n&gt;.json</code>.</p>`,
    );
  } else {
    lines.push(
      `<p>Дифф: медиана ${diff.lines_median}, максимум ${diff.lines_max} строк` +
        ` (замеров: ${diff.measured}); рост — медиана` +
        ` ${escapeHtml(growthValueText(diff.growth_median))}.</p>`,
    );
  }

  return lines;
}

/**
 * Чего не хватает, чтобы измерить цикл: контекст, дифф, провалы гейтов — одним списком.
 * @param {CycleSummary} cycle
 * @returns {string[]}
 */
function cycleGaps(cycle) {
  const gaps = [...(cycle.context?.missing ?? [])];
  // «manifest.<n>.json» от диффа и перечень `manifest.<n>.json` от контекста — один и тот же
  // факт в двух записях: в списке он остаётся один раз.
  const manifestsListed = gaps.some((name) => name.startsWith('manifest.'));
  for (const name of cycle.diff?.missing ?? []) {
    if (name === 'manifest.<n>.json' && manifestsListed) continue;
    if (!gaps.includes(name)) gaps.push(name);
  }
  if ((cycle.checks ?? null) === null) gaps.push('gates.<n>.json');
  return gaps;
}

/**
 * Шапка отчёта в markdown: откуда снят, сколько прочитано и пропущено, каким ядром, и правило
 * «факт — прогон». Всё — из блока `source`; без значения — прочерк, а не догадка.
 * @param {ReportSource} source
 * @returns {string[]}
 */
function sourceMarkdown(source) {
  const dir = source.dir === null ? NO_VALUE : `\`${source.dir}\``;
  const version = source.core.version === null ? NO_VALUE : source.core.version;
  const revision = source.core.revision === null ? NO_VALUE : `\`${source.core.revision}\``;
  return [
    `- Каталог артефактов: ${dir}`,
    `- Прочитано каталогов: ${source.cycles_read}, пропущено: ${source.cycles_skipped}` +
      ` (без \`${FIXED_NAMES.state}\` и \`${FIXED_NAMES.metrics}\`)`,
    `- Ядро: ${version}, ревизия: ${revision}`,
    '- Факт — прогон, а не текст: сводка собрана из артефактов этого каталога, ' +
      'повторный прогон на том же дереве даёт тот же вывод.',
    '',
  ];
}

/**
 * Отчёт в markdown: шапка с итогами, таблица циклов, таблица гейтов, незавершённые циклы
 * и причины остановки.
 * @param {Report} report
 * @returns {string}
 */
export function renderMarkdown(report) {
  const { source, cycles, pending, stops, cost, findings, verification, diff, checks, gates } =
    report;
  /** @type {string[]} */
  const lines = ['# Отчёт по циклам', '', ...sourceMarkdown(source)];

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
      ...verificationMarkdown(verification),
      ...diffAndChecksMarkdown(diff, checks),
      '',
      '| Цикл | Стадия | Итераций | Время, с | Расход, ₽ | Input-токены | Доля кэша | Размер пакета | Рост evidence | Только оценщик | Только ревью | Оба | Дефекты оценщика B/M/m | Неразрешённые ссылки | Незакрытые этапы | Дифф, строк | Рост диффа | Провалы fail/not_run | Не проверено |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
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
          ` | ${cycle.unresolved_refs} | ${cycle.unclosed_stages}` +
          ` | ${diffText(cycle.diff)} | ${diffGrowthText(cycle.diff)}` +
          ` | ${checksText(cycle.checks)}` +
          ` | ${unverifiedText(cycle.verification)} |`,
      );
    }

    lines.push('', ...gapsMarkdown(cycles));

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
.source { margin: 0 0 1rem; padding-left: 1.1rem; font-size: 14px; color: #6b7280; }
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
  .muted, .bars .value, caption, .source { color: #9ca3af; }
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
 * Шапка отчёта в HTML: те же факты, что в markdown-шапке (#114).
 * @param {ReportSource} source
 * @returns {string[]}
 */
function sourceHtml(source) {
  const dir = source.dir === null ? NO_VALUE : `<code>${escapeHtml(source.dir)}</code>`;
  const version = source.core.version === null ? NO_VALUE : escapeHtml(source.core.version);
  const revision =
    source.core.revision === null ? NO_VALUE : `<code>${escapeHtml(source.core.revision)}</code>`;
  const artifacts =
    `без <code>${escapeHtml(FIXED_NAMES.state)}</code>` +
    ` и <code>${escapeHtml(FIXED_NAMES.metrics)}</code>`;
  return [
    '<ul class="source">',
    `<li>Каталог артефактов: ${dir}</li>`,
    `<li>Прочитано каталогов: ${source.cycles_read}, пропущено: ${source.cycles_skipped}` +
      ` (${artifacts})</li>`,
    `<li>Ядро: ${version}, ревизия: ${revision}</li>`,
    '<li><strong>Факт — прогон, а не текст:</strong> сводка собрана из артефактов этого каталога,' +
      ' повторный прогон на том же дереве даёт тот же вывод.</li>',
    '</ul>',
  ];
}

/**
 * Отчёт одной самодостаточной HTML-страницей (#45). Чистая функция: те же факты, что в
 * markdown, без времени, случайности и внешних ресурсов.
 * @param {Report} report
 * @returns {string}
 */
export function renderHtml(report) {
  const { source, cycles, pending, stops, cost, findings, verification, diff, checks, gates } =
    report;
  /** @type {string[]} */
  const body = ['<h1>Отчёт по циклам</h1>', ...sourceHtml(source)];

  if (cycles.length === 0) {
    body.push('<p>Циклов с <code>metrics.json</code> нет: собирать нечего.</p>');
  } else {
    body.push(
      `<p class="lead">Циклов: ${cost.total}, с расходом: ${cost.measured}.` +
        ` Расход: ${rub(cost.sum)} ₽, медиана: ${rub(cost.median)} ₽.</p>`,
      `<p>Находок только у оценщика: ${findings.evaluator_only} из ${findings.total}` +
        ` (${percentText(findings.percent)}).</p>`,
      ...verificationHtml(verification),
      ...diffAndChecksHtml(diff, checks),
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
      'Дифф, строк',
      'Рост диффа',
      'Провалы fail/not_run',
      'Не проверено',
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
            diffText(cycle.diff),
            diffGrowthText(cycle.diff),
            checksText(cycle.checks),
            unverifiedText(cycle.verification),
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

    const gaps = cycles
      .map((cycle) => ({ name: cycle.name, missing: cycleGaps(cycle) }))
      .filter((entry) => entry.missing.length > 0);
    if (gaps.length > 0) {
      body.push('<p class="insufficient"><strong>Нечем мерить (insufficient_data):</strong>');
      for (const gap of gaps) {
        body.push(
          `<br><code>${escapeHtml(gap.name)}</code> — ${escapeHtml(gap.missing.join(', '))}`,
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
    /** Артефакты остановки по имени цикла: читаются один раз — для вердикта и для причин. */
    /** @type {Map<string, ReturnType<typeof collectStopArtifacts>>} */
    const artifacts = new Map();
    let skipped = 0;

    for (const name of names) {
      const cycleDir = join(dir, name);
      const statePath = join(cycleDir, FIXED_NAMES.state);

      if (existsSync(join(cycleDir, FIXED_NAMES.metrics))) {
        const metrics = readArtifact(cycleDir, name, FIXED_NAMES.metrics, validateMetrics);
        const state = existsSync(statePath)
          ? readArtifact(cycleDir, name, FIXED_NAMES.state, validateState)
          : null;
        if (state !== null) states.set(name, state);

        const collected = collectStopArtifacts(cycleDir, name, { state });
        artifacts.set(name, collected);
        cycles.push({
          ...summarizeCycle(name, metrics),
          verification: summarizeVerification(collected),
          diff: summarizeDiff(cycleDir, name),
          checks: summarizeChecks(collected),
        });
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
          artifacts.get(name) ??
            collectStopArtifacts(join(dir, name), name, { state: states.get(name) ?? null }),
        ),
      );

    const report = buildReport(cycles, {
      skipped,
      pending,
      stops,
      source: {
        dir,
        core: { version: coreVersion(root), revision: headRevision({ cwd: root }) },
      },
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
