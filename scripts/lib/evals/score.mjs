/**
 * Скоринг прогонов сидов (docs/evals.md, `docs/orchestrator.md` §15).
 *
 * Прогон — это ответ одного этапа (`review` или `evaluate`) на одном сиде с одной
 * конфигурацией моделей. Модуль отвечает на вопрос «поймал ли этап заложенный дефект»
 * и «сколько ложных блокировок он даёт на чистом диффе», но не решает, хороша ли модель:
 * пороги §15 — это допущение, а не измеренная истина, и вердикт отчёта значит ровно
 * «данные не противоречат порогам».
 *
 * Ответ агента — markdown с последним блоком ```json (Приложение A). Разбор блока не
 * повторяет `cycle-decide` целиком: берётся последний валидный по схеме блок, потому
 * что прогон не участвует в автомате и его JSON не проходит нормализацию.
 *
 * Сопоставление находки с дефектом сида: тот же файл и `|Δline| ≤ LINE_TOLERANCE`
 * (правило §5.6, общее с `cycle-metrics`). У оценщика нет собственных `file`/`line`,
 * поэтому позиция берётся из `evidence[]` вида `path:line` — как в метриках.
 *
 * Повторы одного сида (§15: минимум 3) не затирают друг друга: ячейка «сид + стадия +
 * конфигурация» собирает все наблюдения, статус ячейки — большинство, при равенстве —
 * худший (`aggregateStatuses`). Доля согласия и расхождение видны в отчёте.
 *
 * Shebang не нужен: модуль подключается из CLI-скрипта `evals-score.mjs`.
 */
import { LINE_TOLERANCE } from '../../cycle-metrics.mjs';
import { validateEvaluation, validateReview } from '../cycle/validate.mjs';
import { HIT_SEVERITIES } from './seeds.mjs';

/**
 * Стадия, по которой считается прогон сида.
 * @typedef {'review'|'evaluate'} ScoredStage
 */

/** Этапы, которые участвуют в прогонах сидов: `code` не запускается (§15). */
export const SCORED_STAGES = /** @type {readonly ScoredStage[]} */ (
  Object.freeze(['review', 'evaluate'])
);

/** Ранги серьёзности: находка «не ниже» ожидаемой считается попаданием. */
const SEVERITY_RANK = Object.freeze({ MAJOR: 1, BLOCKER: 2 });

/** Итог прогона по сиду. `invalid` — ответ не разобрался, его нельзя считать ни попаданием, ни промахом. */
export const RUN_STATUSES = Object.freeze(['hit', 'miss', 'clean', 'false_positive', 'invalid']);

/**
 * Порядок «худший первым» для ничьей в агрегате повторов (§15: при равенстве голосов
 * побеждает худший статус). У чистого сида дефекта нет, поэтому худший — ложная блокировка.
 */
const WORST_FIRST = Object.freeze({
  defect: Object.freeze(['invalid', 'miss', 'hit']),
  clean: Object.freeze(['invalid', 'false_positive', 'clean']),
});

/** План повторов, если `meta.json` его не задаёт: старые каталоги — один прогон. */
export const DEFAULT_REPEAT = 1;

/** Ссылка `path:line` из `evidence[]` оценщика. */
const REF_PATTERN = /^(.+):([1-9]\d*)$/u;

/**
 * Плоский объект: массивы и `null` объектами не считаются.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>} сужает тип вызывающего кода
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Все блоки `json` из markdown, в порядке появления. Блок с битым JSON пропускается:
 * агент мог показать пример схемы, а не результат.
 * @param {unknown} markdown ответ агента (нестрока — пустой список блоков)
 * @returns {unknown[]}
 */
export function extractJsonBlocks(markdown) {
  if (typeof markdown !== 'string') return [];

  /** @type {unknown[]} */
  const blocks = [];
  const pattern = /```json[ \t]*\r?\n([\s\S]*?)```/gu;

  for (const match of markdown.matchAll(pattern)) {
    const text = (match[1] ?? '').trim();
    if (text === '') continue;
    try {
      blocks.push(JSON.parse(text));
    } catch {
      // Битый блок — не результат: продолжаем искать следующий.
    }
  }

  return blocks;
}

/**
 * Результат ответа этапа: последний блок, прошедший схему Приложения A.
 * @param {unknown} markdown ответ агента целиком
 * @param {'review'|'evaluate'} stage
 * @returns {{ ok: true, doc: Record<string, any> } | { ok: false, reason: string }}
 */
export function readStageResult(markdown, stage) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return { ok: false, reason: 'пустой ответ' };
  }

  const validator = stage === 'review' ? validateReview : validateEvaluation;
  const blocks = extractJsonBlocks(markdown);
  if (blocks.length === 0) return { ok: false, reason: 'нет блока ```json' };

  /** @type {string[]} */
  let errors = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const result = validator(blocks[index]);
    if (result.ok) return { ok: true, doc: /** @type {Record<string, any>} */ (blocks[index]) };
    errors = result.errors;
  }

  return { ok: false, reason: `последний блок не по схеме: ${errors[0] ?? 'неизвестно'}` };
}

/**
 * Позиция находки ревью: непустой файл и целая строка ≥ 1. Находки вне скоупа
 * и существовавшие до диффа не участвуют: они не про эту правку.
 * @param {unknown} finding
 * @returns {{ file: string, line: number, severity: string }|null}
 */
function reviewPosition(finding) {
  if (!isRecord(finding)) return null;
  if (finding.in_scope !== true) return null;
  if (finding.preexisting === true) return null;
  const file = typeof finding.file === 'string' ? finding.file.trim() : '';
  const line = finding.line;
  const severity = finding.severity;
  if (file === '' || !Number.isInteger(line) || /** @type {number} */ (line) < 1) return null;
  if (typeof severity !== 'string') return null;
  return { file, line: /** @type {number} */ (line), severity };
}

/**
 * Позиции дефекта оценщика из `evidence[]`.
 * @param {unknown} defect
 * @returns {{ file: string, line: number, severity: string }[]}
 */
function defectPositions(defect) {
  if (!isRecord(defect)) return [];
  const severity = defect.severity;
  if (typeof severity !== 'string') return [];
  if (!Array.isArray(defect.evidence)) return [];

  /** @type {{ file: string, line: number, severity: string }[]} */
  const positions = [];
  for (const ref of defect.evidence) {
    if (typeof ref !== 'string') continue;
    const match = REF_PATTERN.exec(ref.trim());
    if (match === null) continue;
    const rawFile = match[1];
    const rawLine = match[2];
    if (rawFile === undefined || rawLine === undefined) continue;
    const file = rawFile.trim();
    if (file === '') continue;
    positions.push({ file, line: Number(rawLine), severity });
  }
  return positions;
}

/**
 * Позиции всех находок ответа в нормализованном виде.
 * @param {'review'|'evaluate'} stage
 * @param {unknown} doc ответ агента (форма проверяется здесь, а не вызывающим)
 * @returns {{ file: string, line: number, severity: string }[]}
 */
export function positionsOf(stage, doc) {
  if (!isRecord(doc)) return [];
  if (stage === 'review') {
    const findings = Array.isArray(doc.findings) ? doc.findings : [];
    return findings.map(reviewPosition).filter((item) => item !== null);
  }

  const defects = Array.isArray(doc.defects) ? doc.defects : [];
  return defects.flatMap(defectPositions);
}

/**
 * Серьёзность не ниже ожидаемой.
 * @param {string} actual
 * @param {'BLOCKER'|'MAJOR'} expected
 * @returns {boolean}
 */
function severityAtLeast(actual, expected) {
  const actualRank = SEVERITY_RANK[/** @type {keyof typeof SEVERITY_RANK} */ (actual)] ?? 0;
  return actualRank >= SEVERITY_RANK[expected];
}

/**
 * Скоринг одного прогона.
 *
 * Для сида-дефекта попаданием считается находка серьёзности не ниже ожидаемой в том же
 * файле и в пределах допуска по строке. Если у сида строка не задана, достаточно файла.
 * Для чистого сида любая находка `BLOCKER`/`MAJOR` — ложная блокировка.
 * @param {{ expect: import('./seeds.mjs').SeedExpectation }} seed ожидание сида
 *   (полный `Seed` не нужен: читается только `expect`)
 * @param {'review'|'evaluate'} stage
 * @param {string} markdown ответ агента
 * @returns {{ status: string, reason: string }}
 */
export function scoreRun(seed, stage, markdown) {
  const result = readStageResult(markdown, stage);
  if (!result.ok) return { status: 'invalid', reason: result.reason };

  const positions = positionsOf(stage, result.doc);

  if (seed.expect.kind === 'clean') {
    const blocking = positions.filter((item) => HIT_SEVERITIES.includes(item.severity));
    const first = blocking[0];
    if (first !== undefined) {
      return {
        status: 'false_positive',
        reason: `${first.severity} в ${first.file}:${first.line}`,
      };
    }
    return { status: 'clean', reason: '' };
  }

  const expected = seed.expect;
  const accepted = expected.severities ?? null;
  const minimum = expected.severity ?? 'BLOCKER';
  /** @param {string} severity @returns {boolean} */
  const severityOk = (severity) =>
    accepted === null ? severityAtLeast(severity, minimum) : accepted.includes(severity);

  const candidate = positions.find((item) => {
    if (!severityOk(item.severity)) return false;
    if (expected.file !== undefined && item.file !== expected.file) return false;
    if (expected.line === undefined) return true;
    return Math.abs(item.line - expected.line) <= LINE_TOLERANCE;
  });

  const wanted = accepted === null ? minimum : accepted.join('|');
  if (candidate === undefined) {
    return { status: 'miss', reason: `ожидался ${wanted} в ${expected.file ?? 'любом файле'}` };
  }
  return { status: 'hit', reason: `${candidate.severity} в ${candidate.file}:${candidate.line}` };
}

/**
 * Доля в сотых: отчёт читают глазами, а не сравнивают побитово, поэтому 2/3 → 0.67.
 * @param {number} part
 * @param {number} total
 * @returns {number|null} `null`, если делить не на что
 */
function share(part, total) {
  if (total === 0) return null;
  return Math.round((part / total) * 100) / 100;
}

/**
 * Агрегат повторов одной ячейки «сид + стадия + конфигурация» (§15: по большинству,
 * при равенстве — худший статус). Последний прогон не побеждает: именно на этом
 * ошибалась прежняя схема `stages[stage] = status`.
 * @param {string[]} statuses статусы повторов в порядке прогонов
 * @param {'clean'|'defect'} kind вид сида: от него зависит, какой статус «хуже»
 * @returns {{
 *   aggregate: string,
 *   count: number,
 *   distribution: Record<string, number>,
 *   agreement: number|null,
 *   disagreement: boolean,
 * }|null} `null`, если повторов нет
 */
export function aggregateStatuses(statuses, kind) {
  if (statuses.length === 0) return null;

  /** @type {Record<string, number>} */
  const counted = {};
  for (const status of statuses) counted[status] = (counted[status] ?? 0) + 1;

  const distribution = /** @type {Record<string, number>} */ ({});
  for (const status of RUN_STATUSES)
    if (counted[status] !== undefined) distribution[status] = counted[status];

  const present = Object.keys(distribution);
  const majority = Math.max(...Object.values(distribution));
  const tied = present.filter((status) => distribution[status] === majority);
  const order = WORST_FIRST[kind === 'clean' ? 'clean' : 'defect'];
  /** @param {string} status @returns {number} */
  const rank = (status) => {
    const index = order.indexOf(status);
    return index === -1 ? order.length : index;
  };

  const aggregate = [...tied].sort((left, right) => rank(left) - rank(right))[0];

  return {
    aggregate: aggregate ?? 'invalid',
    count: statuses.length,
    distribution,
    agreement: share(majority, statuses.length),
    disagreement: present.length > 1,
  };
}

/**
 * Свод по прогонам.
 *
 * Прогоны группируются по конфигурации, внутри — по сиду и этапу. Повторы одного сида
 * не затирают друг друга: ячейка «сид + стадия» собирает все наблюдения и получает
 * агрегат по большинству (`aggregateStatuses`), а полнота считается уже по агрегату.
 * По сиду считается объединение этапов (union), как в §15: полнота меряется на «поймал
 * хоть кто-то», а раздельно этапы нужны, чтобы увидеть, окупается ли каждый из них.
 *
 * Сид-дефект без единого попадания — промах; сид, где все ответы не разобрались, —
 * не промах и не попадание: он выпадает из полноты, но виден в `counts.invalid`.
 * @param {{
 *   runs: Array<{ config: string, seed: string, stage: string, status: string, reason?: string, cost_rub?: number|null, repeat?: number }>,
 *   seeds: Record<string, 'clean'|'defect'>,
 *   thresholds: { completeness: number, false_positive_max: number },
 * }} input
 * @returns {Record<string, any>} отчёт
 */
export function buildReport({ runs, seeds, thresholds }) {
  /** @type {Record<string, any>} */
  const configs = {};

  for (const run of runs) {
    const config = (configs[run.config] ??= {
      runs: 0,
      by_seed: {},
      by_stage: {},
      cost_rub: 0,
      cost_known: 0,
      counts: Object.fromEntries(RUN_STATUSES.map((status) => [status, 0])),
    });

    config.runs += 1;
    const seedEntry = (config.by_seed[run.seed] ??= { stages: {}, runs: {}, union: 'miss' });
    const cell = (seedEntry.runs[run.stage] ??= { statuses: [], planned: DEFAULT_REPEAT });
    cell.statuses.push(run.status);
    if (Number.isInteger(run.repeat) && /** @type {number} */ (run.repeat) >= 1)
      cell.planned = Math.max(cell.planned, /** @type {number} */ (run.repeat));
    const stageEntry = (config.by_stage[run.stage] ??= {
      counts: Object.fromEntries(RUN_STATUSES.map((status) => [status, 0])),
    });
    stageEntry.counts[run.status] += 1;
    config.counts[run.status] += 1;

    if (typeof run.cost_rub === 'number' && Number.isFinite(run.cost_rub)) {
      config.cost_rub += run.cost_rub;
      config.cost_known += 1;
    }
  }

  /** @type {string[]} */
  const warnings = [];
  let repeatsPlan = DEFAULT_REPEAT;
  let cells = 0;
  let disagreements = 0;

  for (const [name, config] of Object.entries(configs)) {
    let hits = 0;
    let misses = 0;
    let cleanRuns = 0;
    let falsePositives = 0;
    /** @type {{ review: number, evaluate: number }} */
    const exclusive = { review: 0, evaluate: 0 };

    for (const [seedId, seedEntry] of Object.entries(config.by_seed)) {
      const kind = seeds[seedId] === 'clean' ? 'clean' : 'defect';
      // Агрегат считается до union: в `stages` лежит уже результат повторов, а не
      // последнее наблюдение.
      for (const stage of SCORED_STAGES) {
        const cell = seedEntry.runs[stage];
        if (cell === undefined) continue;
        const aggregate = aggregateStatuses(cell.statuses, kind);
        if (aggregate === null) continue;
        cell.aggregate = aggregate.aggregate;
        cell.count = aggregate.count;
        cell.distribution = aggregate.distribution;
        cell.agreement = aggregate.agreement;
        cell.disagreement = aggregate.disagreement;
        seedEntry.stages[stage] = aggregate.aggregate;

        cells += 1;
        if (aggregate.disagreement) disagreements += 1;
        repeatsPlan = Math.max(repeatsPlan, cell.planned);
        if (aggregate.count < cell.planned) {
          warnings.push(
            `${name}: ${seedId}/${stage} — ${aggregate.count} из ${cell.planned} повторов`,
          );
        }
      }

      const statuses = SCORED_STAGES.map((stage) => seedEntry.stages[stage]).filter(
        (status) => typeof status === 'string',
      );
      const hitStages = SCORED_STAGES.filter((stage) => seedEntry.stages[stage] === 'hit');
      const allInvalid = statuses.length > 0 && statuses.every((status) => status === 'invalid');

      if (seeds[seedId] === 'clean') {
        seedEntry.union = 'clean';
        if (allInvalid) {
          seedEntry.union = 'invalid';
          continue;
        }
        cleanRuns += 1;
        if (statuses.includes('false_positive')) {
          seedEntry.union = 'false_positive';
          falsePositives += 1;
        }
        continue;
      }

      if (statuses.includes('hit')) {
        seedEntry.union = 'hit';
        hits += 1;
        const onlyHit = hitStages[0];
        // Эксклюзивный хит: сид поймала ровно одна стадия, значит её и записываем.
        if (hitStages.length === 1 && (onlyHit === 'review' || onlyHit === 'evaluate')) {
          exclusive[onlyHit] += 1;
        }
        continue;
      }

      if (allInvalid) {
        seedEntry.union = 'invalid';
        continue;
      }

      seedEntry.union = 'miss';
      misses += 1;
    }

    const scored = hits + misses;
    const completeness = scored === 0 ? null : hits / scored;
    const falsePositiveRate = cleanRuns === 0 ? null : falsePositives / cleanRuns;

    config.summary = {
      hits,
      misses,
      completeness,
      clean_runs: cleanRuns,
      false_positives: falsePositives,
      false_positive_rate: falsePositiveRate,
      exclusive,
      avg_cost_rub: config.cost_known === 0 ? null : config.cost_rub / config.cost_known,
      repeats: DEFAULT_REPEAT,
      disagreement: null,
    };
    config.name = name;
  }

  for (const config of Object.values(configs)) {
    const own = Object.values(config.by_seed).flatMap((seedEntry) =>
      SCORED_STAGES.map((stage) => seedEntry.runs[stage]).filter((cell) => cell !== undefined),
    );
    if (own.length === 0) continue;
    config.summary.repeats = own.reduce((max, cell) => Math.max(max, cell.planned ?? 1), 1);
    const disagreed = own.filter((cell) => cell.disagreement === true).length;
    config.summary.disagreement = share(disagreed, own.length);
  }

  /** @type {string[]} */
  const failures = [];
  for (const config of Object.values(configs)) {
    const summary = config.summary;
    if (summary.completeness !== null && summary.completeness < thresholds.completeness) {
      failures.push(
        `${config.name}: полнота ${summary.completeness.toFixed(2)} < ${thresholds.completeness}`,
      );
    }
    if (
      summary.false_positive_rate !== null &&
      summary.false_positive_rate > thresholds.false_positive_max
    ) {
      failures.push(
        `${config.name}: ложные блокировки ${summary.false_positive_rate.toFixed(2)} > ${thresholds.false_positive_max}`,
      );
    }
  }

  return {
    thresholds: {
      completeness: thresholds.completeness,
      false_positive_max: thresholds.false_positive_max,
      line_tolerance: LINE_TOLERANCE,
    },
    configs,
    failures,
    warnings,
    // Доля ячеек, где повторы разошлись: разброс — главный повод повторять сид.
    disagreement: share(disagreements, cells),
    repeats: repeatsPlan,
    verdict: failures.length === 0 ? 'ok' : 'below_threshold',
  };
}
