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
 * **`--html` (#45).** Тот же отчёт одной самодостаточной страницей: стили внутри, без внешних
 * ресурсов и без JS — файл открывается с диска и в сеть не ходит (`> report.html` делает
 * человек, поэтому контракт «ничего не пишет на диск» сохраняется). Модель отчёта общая с
 * markdown: `renderHtml` и `renderMarkdown` берут один `Report`, второго источника правды нет.
 * Ширина полоски расхода — доля от максимума в отчёте, число подписано рядом; всё считается
 * из данных, поэтому два запуска дают побайтно одинаковую страницу.
 *
 * **Что попадает в отчёт.** Каталоги без `metrics.json` пропускаются (цикл не завершён или
 * метрики не собирались) — их число печатается отдельно, чтобы «нет данных» не выглядело
 * как «ноль». Битый или не проходящий схему `metrics.json` — отказ (код 2): молча
 * пропустить испорченный артефакт значило бы занизить расход.
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
import { loadConfig } from './lib/cycle/config.mjs';
import { readJson } from './lib/cycle/io.mjs';
import { FIXED_NAMES, artifactsDir, repoRoot } from './lib/cycle/paths.mjs';
import { validateMetrics } from './lib/cycle/validate.mjs';

/** Серьёзности дефектов оценщика (Приложение A). */
const DEFECT_SEVERITIES = Object.freeze(['BLOCKER', 'MAJOR', 'MINOR']);

/** Статусы гейта (§5.5) — по ним ведутся исходы. */
const GATE_STATUSES = Object.freeze(['pass', 'fail', 'skipped', 'not_run']);

/** Нет данных: в ячейке честная прочерк, а не ноль. */
const NO_VALUE = '—';

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
 */

/**
 * @typedef {object} Report
 * @property {CycleSummary[]} cycles
 * @property {number} skipped каталоги без `metrics.json`
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
 * Каталоги циклов с `metrics.json` в каталоге артефактов, отсортированные по имени.
 * @param {string} dir каталог артефактов
 * @returns {string[]} имена каталогов
 */
export function listCycleDirs(dir) {
  if (!existsSync(dir)) throw new Error(`${dir}: каталог артефактов не найден`);
  return readdirSync(dir)
    .filter((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() && existsSync(join(path, FIXED_NAMES.metrics));
    })
    .sort();
}

/**
 * Читает и проверяет `metrics.json` одного цикла. Сообщение содержит имя каталога, а не
 * абсолютный путь: отчёт можно вставлять в issue.
 * @param {string} dir каталог артефактов
 * @param {string} name имя каталога цикла
 * @returns {Record<string, any>}
 */
function readMetrics(dir, name) {
  const file = join(dir, name, FIXED_NAMES.metrics);

  /** @type {unknown} */
  let doc;
  try {
    doc = readJson(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}/${FIXED_NAMES.metrics}: не читается (${message})`, { cause: error });
  }

  const check = validateMetrics(doc);
  if (!check.ok) {
    throw new Error(`${name}/${FIXED_NAMES.metrics}: схема нарушена:\n${check.errors.join('\n')}`);
  }
  return /** @type {Record<string, any>} */ (doc);
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
 * Собирает отчёт из прочитанных метрик. Чистая функция: файлов не читает.
 * @param {CycleSummary[]} cycles сводки по циклам (в порядке отчёта)
 * @param {{ skipped?: number, gateIds?: readonly string[] }} [options]
 * @returns {Report}
 */
export function buildReport(cycles, { skipped = 0, gateIds = [] } = {}) {
  const costs = cycles.map((cycle) => cycle.cost_rub).filter((value) => value !== null);
  const evaluatorOnly = cycles.reduce((sum, cycle) => sum + cycle.findings.only_evaluator, 0);
  const totalFindings = cycles.reduce(
    (sum, cycle) =>
      sum + cycle.findings.only_review + cycle.findings.only_evaluator + cycle.findings.both,
    0,
  );

  return {
    cycles,
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
 * Отчёт в markdown: шапка с итогами, таблица циклов, таблица гейтов.
 * @param {Report} report
 * @returns {string}
 */
export function renderMarkdown(report) {
  const { cycles, cost, findings, skipped, gates } = report;
  /** @type {string[]} */
  const lines = ['# Отчёт по циклам', ''];

  if (cycles.length === 0) {
    lines.push(
      'Циклов с `metrics.json` нет: собирать нечего.',
      '',
      `Пропущено каталогов без \`${FIXED_NAMES.metrics}\`: ${skipped}.`,
      '',
    );
    return lines.join('\n');
  }

  lines.push(
    `Циклов: ${cost.total}, с расходом: ${cost.measured}.` +
      ` Расход: ${rub(cost.sum)} ₽, медиана: ${rub(cost.median)} ₽.`,
    '',
    `Находок только у оценщика: ${findings.evaluator_only} из ${findings.total}` +
      ` (${percentText(findings.percent)}).`,
    '',
    `Пропущено каталогов без \`${FIXED_NAMES.metrics}\`: ${skipped}.`,
    '',
    '| Цикл | Стадия | Итераций | Время, с | Расход, ₽ | Только оценщик | Только ревью | Оба | Дефекты оценщика B/M/m | Неразрешённые ссылки | Незакрытые этапы |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );

  for (const cycle of cycles) {
    const defects = cycle.evaluator_defects;
    lines.push(
      `| ${cycle.name} | ${cycle.final_stage} | ${cycle.iterations}/${cycle.max_iterations}` +
        ` | ${Math.round(cycle.duration_s)} | ${rub(cycle.cost_rub)}` +
        ` | ${cycle.findings.only_evaluator} | ${cycle.findings.only_review} | ${cycle.findings.both}` +
        ` | ${defects.BLOCKER}/${defects.MAJOR}/${defects.MINOR}` +
        ` | ${cycle.unresolved_refs} | ${cycle.unclosed_stages} |`,
    );
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
@media (prefers-color-scheme: dark) {
  body { background: #111827; color: #e5e7eb; }
  th, td { border-color: #374151; }
  thead th, .track { background: #1f2937; }
  tbody tr:nth-child(even) { background: #0f172a; }
  .fill { background: #60a5fa; }
  .muted, .bars .value, caption { color: #9ca3af; }
}`;

/**
 * Отчёт одной самодостаточной HTML-страницей (#45). Чистая функция: те же факты, что в
 * markdown, без времени, случайности и внешних ресурсов.
 * @param {Report} report
 * @returns {string}
 */
export function renderHtml(report) {
  const { cycles, cost, findings, skipped, gates } = report;
  /** @type {string[]} */
  const body = ['<h1>Отчёт по циклам</h1>'];

  if (cycles.length === 0) {
    body.push(
      '<p>Циклов с <code>metrics.json</code> нет: собирать нечего.</p>',
      `<p class="muted">Пропущено каталогов без <code>${escapeHtml(FIXED_NAMES.metrics)}</code>: ${skipped}.</p>`,
    );
    return htmlPage('Отчёт по циклам', body);
  }

  body.push(
    `<p class="lead">Циклов: ${cost.total}, с расходом: ${cost.measured}.` +
      ` Расход: ${rub(cost.sum)} ₽, медиана: ${rub(cost.median)} ₽.</p>`,
    `<p>Находок только у оценщика: ${findings.evaluator_only} из ${findings.total}` +
      ` (${percentText(findings.percent)}).</p>`,
    `<p class="muted">Пропущено каталогов без <code>${escapeHtml(FIXED_NAMES.metrics)}</code>: ${skipped}.</p>`,
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
    const args = parseArgs(process.argv.slice(2));
    const root = repoRoot();
    const config = loadConfig(root);
    const dir = args.dir === null ? artifactsDir(root, config) : resolve(args.dir);

    const names = listCycleDirs(dir);
    const cycles = names.map((name) => summarizeCycle(name, readMetrics(dir, name)));
    const skipped = readdirSync(dir).filter((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() && !existsSync(join(path, FIXED_NAMES.metrics));
    }).length;

    const report = buildReport(cycles, {
      skipped,
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
