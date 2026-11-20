#!/usr/bin/env node
/**
 * Тело PR по артефактам цикла (docs/orchestrator-core.md §5.7, issue #158, задача T6b).
 *
 *   node scripts/cycle-pr-body.mjs --dir D [--draft-escalation]
 *
 * Скрипт собирает тело PR по `.github/PULL_REQUEST_TEMPLATE.md` из фактов цикла и печатает
 * его в stdout. На диск ничего не пишется: PR открывает супервизор (Приложение B, этап
 * `PROCEED*`), а скрипт остаётся чистым сборщиком текста.
 *
 * **Входы.** Обязательные: `state.json`, `gates.<n>.json`, `review.<n>.json`,
 * `evaluation.<n>.json`, `decision.<n>.json`, `evidence/criteria.md` — `n` берётся из
 * `state.iteration` (`iterNames`). Необязательные: `code-report.<n>.md` / `plan.<n>.md`
 * (источник пунктов «Что сделано»), `followups.md` (раздел «Вне скоупа»), `escalation.json`
 * (баннер при `--draft-escalation`) и `evidence/integrity.json` (правки тестов и
 * защищённых файлов, #27). Отсутствие необязательного файла — не ошибка, раздел
 * остаётся заглушкой; битый или отсутствующий обязательный — код 2: без него разделы PR
 * были бы выдуманными. Перед сборкой каждый документ проходит валидатор схемы из
 * `lib/cycle/validate.mjs` — своего разбора структуры здесь нет.
 *
 * **Структура.** Секции шаблона идут в его порядке: «Что сделано» (пункты из артефактов
 * прохода и обязательная строка `Closes #<issue>` из `state.issue`), «Как проверять»
 * (что осталось проверить руками по исходам гейтов), «Проверки» (чекбоксы из
 * `gates.<n>.json`: `- [x]` только у `pass`/`skipped`), «Независимая оценка» (§5.7:
 * вердикты ревью и оценки рядом, таблица критериев `C1…Cn` в порядке `criteria.md`,
 * `partial`/`unverified`, замечания ревью, при `PROCEED_WITH_UNVERIFIED` — блок
 * «не проверено» с чекбоксами для владельца), «Риски» (пункты шаблона PR проекта из
 * `paths.prTemplate`: чекбоксы переносятся как есть, их отмечает человек; своего списка
 * рисков ядро не держит), «Вне скоупа» (пункты `followups.md`).
 * С `--draft-escalation` в начало добавляется баннер: причина, пояснение,
 * `draft_pr_allowed` и открытые замечания из `escalation.json`.
 *
 * **Дедупликация «не проверено».** Один и тот же факт приходит из двух артефактов: `cycle-decide`
 * пишет в `decision.unverified[]` строку `evaluation unverified: <what>`, а
 * `evaluation.unverified[]` хранит `what` и `why`. В блоке «не проверено» пункт печатается
 * один раз — в более полной формулировке (`<what> — <why>`); сравнение идёт по
 * нормализованной форме без префикса источника (#204).
 *
 * **Ссылки критериев.** В колонке «Свидетельство» — первая *разрешаемая* ссылка из
 * `evaluation.criteria[].evidence` (`resolveRef`: файл существует, строка в файле, гейт есть
 * в `gates.<n>.json`). Если не разрешается ни одна, показывается первая ссылка как есть, а
 * при пустом `evidence` — примечание критерия: предпочтение отдаётся проверяемому
 * свидетельству, но само свидетельство не теряется. Неразрешённая ссылка — свободный текст
 * из артефакта, поэтому маскируется так же, как остальной текст (§5.4): `evidence[]` —
 * произвольная непустая строка, а тело PR публично.
 *
 * **Полнота оценивания.** Набор id в `evaluation.criteria` обязан покрывать критерии
 * `evidence/criteria.md`: иначе строка таблицы осталась бы без статуса. Пропуск — ошибка
 * сборки (код 2), а не ячейка `—`: таблица статусов в PR не должна быть неполной.
 *
 * **Детерминизм.** Ни времени, ни случайности, ни зависимости от порядка ключей объектов
 * входа: гейты сортируются по порядку `gates` конфига проекта, критерии — по `criteria.md`, списки —
 * по порядку источника. Два запуска на одних входах дают побайтно одинаковый вывод.
 *
 * **ПДн.** Тело PR публично, а артефакты цикла — нет. Любой свободный текст из них
 * (`summary` и `id` находок, ссылка и `note` критерия, `detail` и `open_items` эскалации,
 * `unverified` оценщика и решения, пункты `followups.md` и «Что сделано») проходит через
 * `redactLog`: телефоны, e-mail и секреты становятся `[phone]`/`[email]`/`[secret]`.
 * Формулировки критериев берутся из issue дословно (issue публичен), сырые логи и QA не
 * копируются. Пути из `evidence/integrity.json` — это вывод git, а не свободный текст, но
 * они тоже проходят через `cell()`: имя файла с `|` не должно ломать markdown.
 *
 * **Коды выхода.** `0` — тело собрано; `2` — ошибка использования или внутренняя (нет
 * каталога или обязательного артефакта, битый JSON, нарушена схема, критерий из
 * `criteria.md` остался без статуса, мусор в аргументах). Диагностика — в stderr без
 * стектрейса. Shebang нужен: файл запускается напрямую.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isDirectRun } from './lib/cycle/cli.mjs';
import { loadConfig, takeConfigOption } from './lib/cycle/config.mjs';
import { CRITERIA_FILE, criteriaMismatch, parseCriteria } from './lib/cycle/criteria.mjs';
import { readJson } from './lib/cycle/io.mjs';
import { FIXED_NAMES, findActiveCycle, iterNames, repoRoot } from './lib/cycle/paths.mjs';
import { redactLog } from './lib/cycle/redact.mjs';
import { resolveRef } from './lib/cycle/refs.mjs';
import {
  validateDecision,
  validateEscalation,
  validateEvaluation,
  validateGates,
  validateIntegrity,
  validateReview,
  validateState,
} from './lib/cycle/validate.mjs';

/** Контроль целостности проверок: артефакт `packet`-а (#27). */
const INTEGRITY_FILE = 'integrity.json';

/** Сколько пунктов «Что сделано» брать из артефактов прохода (шаблон: 1–3). */
const SUMMARY_LIMIT = 3;

/** Предел длины свободного текста в ячейке таблицы: простыни в PR не читаются. */
const MAX_CELL = 160;

/** Положительный вердикт ревью (Приложение A). */
const REVIEW_POSITIVE = 'merge-ready';

/** Вердикты оценки, не требующие доработки (Приложение A). */
const EVALUATION_POSITIVE = Object.freeze(['ACCEPT', 'ACCEPT_WITH_FOLLOWUPS']);

/** Действие решения, добавляющее блок «не проверено» (§5.7). */
const PROCEED_WITH_UNVERIFIED = 'PROCEED_WITH_UNVERIFIED';

/**
 * Сколько путей из одной группы `evidence/integrity.json` показывать в PR: остальные
 * сворачиваются в «и ещё N». Длинный список в строке «Проверок» не читается.
 */
const INTEGRITY_LIMIT = 5;

/** Группы `evidence/integrity.json` и их подписи в PR (#27). */
const INTEGRITY_GROUPS = Object.freeze([
  { key: 'tests', label: 'Тесты' },
  { key: 'protected', label: 'Защищённые файлы' },
]);

/** Статусы изменения файла в `evidence/integrity.json` и их подписи. */
const INTEGRITY_STATUSES = Object.freeze([
  { key: 'added', label: 'добавлено' },
  { key: 'modified', label: 'изменено' },
  { key: 'deleted', label: 'удалено' },
]);

/**
 * Заголовок раздела «Риски» в шаблоне PR. Список рисков — свойство проекта: ядро берёт
 * пункты из шаблона (`paths.prTemplate`) и не подставляет свой.
 */
const RISKS_HEADING = /^(#{1,6})[ \t]+Риски[ \t]*$/u;

/**
 * HTML-комментарий шаблона: подсказки для человека в пункты не попадают.
 * Комментарии не вкладываются, поэтому ленивое совпадение до первого `-->` корректно.
 */
const HTML_COMMENT = /<!--[\s\S]*?-->/gu;

/** Элемент списка markdown: `- `, `* `, `1.`; содержимое — остаток строки. */
const LIST_ITEM = /^[ \t]*(?:[-*]|\d+\.)[ \t]+(.*)$/;

/** Чекбокс в начале элемента списка: `[ ]`, `[x]`, `[X]`. */
const CHECKBOX = /^\[[ xX]\][ \t]*(.*)$/;

/** Заголовок markdown: закрывает предыдущий пункт списка. */
const HEADING = /^#{1,6}[ \t]/;

/** Заголовок markdown с уровнем: `## Риски` закрывает раздел того же или более высокого уровня. */
const HEADING_LEVEL = /^(#{1,6})[ \t]+/;

/**
 * Префикс источника в `decision.unverified[]`: `cycle-decide` пишет `evaluation unverified: <what>`
 * (§5.6). При сборке тела PR тот же факт приходит и из `evaluation.unverified[]` — префикс
 * снимается при сравнении, иначе один пункт попадает в PR дважды (#204).
 */
const SOURCE_PREFIX = /^(?:evaluation|review|decision)[ \t]+unverified:[ \t]*/iu;

/**
 * Непустая строка после обрезки пробелов.
 * @param {unknown} value
 * @returns {value is string} сужает тип вызывающего кода
 */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Свободный текст артефакта для публичного PR: маскируется по §5.4.
 * Нестроковое значение приводится к строке — иначе маскировать было бы нечего.
 * @param {unknown} value
 * @returns {string}
 */
function redacted(value) {
  return redactLog(typeof value === 'string' ? value : String(value));
}

/**
 * Текст в одну строку: пробельные последовательности, включая переводы строк, — один пробел.
 * @param {string} text
 * @returns {string}
 */
function singleLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Ячейка markdown-таблицы: одна строка, ограничение длины, экранированный `|`.
 * @param {string} text
 * @returns {string}
 */
function cell(text) {
  const value = singleLine(text);
  const shortened = value.length <= MAX_CELL ? value : `${value.slice(0, MAX_CELL - 1).trimEnd()}…`;
  return shortened.replace(/\|/g, '\\|');
}

/**
 * Нормализованная форма пункта «не проверено»: без префикса источника и без разницы
 * в регистре/пробелах. Сравнение по ней, а не по сырому тексту — иначе формулировки
 * одного и того же факта из двух артефактов считаются разными.
 * @param {string} text
 * @returns {string}
 */
function unverifiedKey(text) {
  return singleLine(text).replace(SOURCE_PREFIX, '').toLowerCase();
}

/**
 * Один ли это факт в двух формулировках: точное совпадение или более короткая версия —
 * начало более полной на границе слова (`<what>` против `<what> — <why>`).
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function sameUnverified(left, right) {
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (!longer.startsWith(shorter)) return false;
  return /^[\s—–-]/u.test(longer.slice(shorter.length));
}

/**
 * Дедупликация пунктов «не проверено» из `decision.unverified[]` и
 * `evaluation.unverified[]`. Из пары остаётся более полная формулировка, позиция — первого
 * вхождения (порядок артефактов сохраняется, вывод детерминирован).
 * @param {string[]} items
 * @returns {string[]}
 */
export function dedupeUnverified(items) {
  if (!Array.isArray(items)) throw new TypeError('dedupeUnverified: ожидается массив');

  /** @type {{ key: string, text: string }[]} */
  const kept = [];
  for (const item of items) {
    if (!isText(item)) continue;
    const text = singleLine(item);
    const key = unverifiedKey(text);
    const index = kept.findIndex((entry) => sameUnverified(entry.key, key));
    const existing = kept[index];
    if (existing === undefined) kept.push({ key, text });
    else if (text.length > existing.text.length) kept[index] = { key, text };
  }

  return kept.map((entry) => entry.text);
}

/**
 * Элементы markdown-списка. Строки без маркера — продолжение текущего пункта (пункт
 * остаётся одной строкой); пустая строка или заголовок закрывают пункт.
 * Локальная реализация, а не `parseListItems` из `cycle-evidence.mjs`: тот разбирает
 * тело issue и тянет за собой весь CLI оценщика, а здесь нужны только пункты `.md`.
 * @param {string} markdown
 * @returns {string[]}
 */
export function listItems(markdown) {
  if (typeof markdown !== 'string') throw new TypeError('listItems: ожидается строка');

  /** @type {string[]} */
  const items = [];
  /** @type {number|null} индекс пункта, к которому относится продолжение */
  let open = null;

  for (const line of markdown.split(/\r?\n/)) {
    const match = LIST_ITEM.exec(line);
    if (match !== null) {
      const itemText = match[1] ?? '';
      const checkbox = CHECKBOX.exec(itemText);
      const value = (checkbox === null ? itemText : (checkbox[1] ?? '')).trim();
      if (value === '') {
        open = null;
        continue;
      }
      items.push(value);
      open = items.length - 1;
      continue;
    }

    const continuation = line.trim();
    if (continuation === '' || HEADING.test(continuation)) {
      open = null;
      continue;
    }
    // Проза до первого пункта критерием не становится, после пункта — его продолжение.
    if (open === null) continue;
    items[open] = `${items[open]} ${continuation}`;
  }

  return items;
}

/**
 * Пункты раздела «Риски» шаблона PR: чекбоксы переносятся как есть (их отмечает человек),
 * других разделов и HTML-комментариев шаблона в результате нет. Раздела нет или он пуст —
 * пустой массив: чужой список рисков ядро не выдумывает (правило 1 `AGENTS.md`).
 * @param {string} markdown содержимое шаблона PR
 * @returns {string[]} строки пунктов с маркером списка и чекбоксом
 */
export function riskItems(markdown) {
  if (typeof markdown !== 'string') throw new TypeError('riskItems: ожидается строка');

  const lines = markdown.replace(HTML_COMMENT, '').split(/\r?\n/);
  let level = 0;
  /** @type {string[]} */
  const items = [];
  /** @type {number|null} индекс пункта, к которому относится продолжение */
  let open = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (level === 0) {
      const heading = RISKS_HEADING.exec(trimmed);
      if (heading !== null) level = (heading[1] ?? '').length;
      continue;
    }

    // Раздел закончился: следующий заголовок того же или более высокого уровня.
    const heading = HEADING_LEVEL.exec(trimmed);
    if (heading !== null && (heading[1] ?? '').length <= level) break;
    if (heading !== null) {
      open = null;
      continue;
    }

    const match = LIST_ITEM.exec(line);
    if (match !== null) {
      const text = (match[1] ?? '').trim();
      open = null;
      if (text === '') continue;
      items.push(trimmed);
      open = items.length - 1;
      continue;
    }

    // Перенос строки внутри пункта — тот же пункт; проза до первого пункта не пункт.
    if (trimmed === '' || open === null) {
      open = null;
      continue;
    }
    items[open] = `${items[open]} ${trimmed}`;
  }

  return items;
}

/**
 * @typedef {import('./lib/cycle/criteria.mjs').Criterion} Criterion
 */

// Критерии читаются и в PR-таблицу, и в дайджест заморозки одним разбором.
export { parseCriteria };

/**
 * Пустая ячейка таблицы: так помечается отсутствующее значение, а не выдуманное.
 * @returns {string}
 */
function emptyCell() {
  return '—';
}

/**
 * Ссылка на свидетельство для ячейки таблицы: первая разрешаемая из `evidence[]`,
 * иначе первая как есть, иначе примечание критерия. Текст маскируется (§5.4).
 * @param {Record<string, any>} criterion критерий оценки
 * @param {import('./lib/cycle/refs.mjs').RefContext} ctx
 * @returns {string}
 */
function evidenceCell(criterion, ctx) {
  const evidence = Array.isArray(criterion.evidence) ? criterion.evidence : [];
  for (const ref of evidence) {
    if (resolveRef(ref, ctx).ok) return cell(`\`${ref.trim()}\``);
  }
  // Неразрешённая ссылка не прошла ни одну проверку формы, поэтому это свободный текст из
  // вывода агента: маскируется наравне с прочим (§5.4), иначе телефон или e-mail из
  // `evidence[]` попадёт в публичное тело PR.
  if (evidence.length > 0) return cell(`\`${redacted(String(evidence[0]).trim())}\``);
  if (isText(criterion.note)) return cell(redacted(criterion.note));
  return emptyCell();
}

/**
 * Сноска гейта: причина для `not_run`/`skipped`, код выхода для `fail`.
 * @param {Record<string, any>} gate
 * @returns {string} ` (…)` или пустая строка
 */
function gateNote(gate) {
  /** @type {string[]} */
  const parts = [];
  if (gate.status === 'fail' && Number.isInteger(gate.exit)) parts.push(`exit ${gate.exit}`);
  if (isText(gate.reason)) parts.push(gate.reason.trim());
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

/**
 * Гейты в порядке таблицы §5.5; неизвестные id (расширение таблицы) — после известных,
 * по алфавиту: порядок строк не должен зависеть от порядка файла.
 * @param {unknown} value `gates[].gates`
 * @param {readonly string[]} [gateIds] порядок id из конфига проекта
 * @returns {Record<string, any>[]}
 */
export function orderGates(value, gateIds = []) {
  /** @type {Record<string, any>[]} */
  const entries = Array.isArray(value)
    ? value.filter((gate) => typeof gate === 'object' && gate !== null && !Array.isArray(gate))
    : [];
  const order = new Map(gateIds.map((id, index) => [id, index]));
  /** @param {Record<string, any>} gate @returns {number} */
  const known = (gate) => order.get(String(gate.id)) ?? gateIds.length;

  return [...entries].sort((left, right) => {
    const delta = known(left) - known(right);
    if (delta !== 0) return delta;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
}

/**
 * Список путей в строке PR: `\`path\`` через запятую, не больше `INTEGRITY_LIMIT` штук
 * (остальные — «и ещё N»). Путь экранируется через `cell()`: имя файла с `|` не ломает markdown.
 * @param {string[]} paths отсортированные пути из артефакта
 * @returns {string}
 */
function pathList(paths) {
  const shown = paths.slice(0, INTEGRITY_LIMIT).map((path) => `\`${cell(path)}\``);
  const rest = paths.length - shown.length;
  if (rest > 0) shown.push(`и ещё ${rest}`);
  return shown.join(', ');
}

/**
 * Факты целостности проверок для раздела «Проверки» (#27). Файла `evidence/integrity.json`
 * нет — секция `integrity` в конфиге не задана, строк нет: ядро не выдумывает проверку,
 * которой нет. Своих суждений о том, «ослаблены ли тесты», скрипт не добавляет — только
 * факты из артефакта.
 * @param {Record<string, any>|null} integrity проверенный документ или `null`
 * @returns {string[]} строки markdown (пустой массив — секции нет)
 */
export function integrityFacts(integrity) {
  if (integrity === null) return [];

  /** @type {string[]} */
  const lines = [];
  for (const { key, label } of INTEGRITY_GROUPS) {
    const group = integrity[key];
    /** @type {string[]} */
    const parts = [];
    for (const { key: status, label: wording } of INTEGRITY_STATUSES) {
      const paths = Array.isArray(group[status]) ? group[status] : [];
      if (paths.length === 0) continue;
      parts.push(`${wording} ${paths.length} (${pathList(paths)})`);
    }
    if (parts.length > 0) lines.push(`- ${label}: ${parts.join('; ')}.`);
  }

  if (lines.length === 0) lines.push('- Тесты и защищённые файлы: правок нет.');
  return lines;
}

/**
 * Баннер эскалации (§5.7): причина, пояснение, `draft_pr_allowed` и открытые замечания.
 * @param {Record<string, any>} escalation проверенный `escalation.json`
 * @returns {string}
 */
export function renderEscalationBanner(escalation) {
  /** @type {string[]} */
  const lines = ['> [!WARNING]', `> **Draft PR: эскалация \`${escalation.reason}\`.**`];

  if (isText(escalation.detail)) {
    for (const line of redacted(escalation.detail).split(/\r?\n/)) lines.push(`> ${line.trim()}`);
  }
  lines.push(`> Draft PR разрешён: ${escalation.draft_pr_allowed === true ? 'да' : 'нет'}.`);

  const openItems = Array.isArray(escalation.open_items) ? escalation.open_items : [];
  if (openItems.length > 0) {
    lines.push('>', '> Открытые замечания:', '>');
    for (const item of openItems) lines.push(`> - ${redacted(item)}`);
  }

  return lines.join('\n');
}

/**
 * Пункты «Что сделано»: первые `SUMMARY_LIMIT` пунктов `code-report.<n>.md`, при его
 * отсутствии — `plan.<n>.md`. Формулировки берутся из артефактов дословно, своих скрипт
 * не придумывает; маскирование (§5.4) применяет `renderPrBody`.
 * @param {string} dir каталог цикла
 * @param {ReturnType<typeof iterNames>} names имена файлов итерации
 * @returns {string[]}
 */
export function summaryItems(dir, names) {
  for (const file of [names.codeReport, names.plan]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;

    const items = listItems(readFileSync(path, 'utf8'));
    if (items.length > 0) return items.slice(0, SUMMARY_LIMIT);
  }
  return [];
}

/**
 * Тело PR целиком. Чистая функция: файлов не читает, время и случайность не использует.
 * @param {{
 *   state: Record<string, any>,
 *   gates: Record<string, any>,
 *   review: Record<string, any>,
 *   evaluation: Record<string, any>,
 *   decision: Record<string, any>,
 *   criteria: Criterion[],
 *   summary: string[],
 *   followups: string[],
 *   escalation: Record<string, any>|null,
 *   risks: string[]|null,
 *   integrity?: Record<string, any>|null,
 *   root: string,
 *   gateIds?: readonly string[],
 * }} inputs
 * @returns {string} тело PR с завершающим переводом строки
 */
export function renderPrBody(inputs) {
  const {
    state,
    gates,
    review,
    evaluation,
    decision,
    criteria,
    summary,
    followups,
    escalation,
    risks,
    integrity = null,
    root,
    gateIds = [],
  } = inputs;

  /** @type {Record<string, any>[]} */
  const gateEntries = orderGates(gates.gates, gateIds);
  /** @type {import('./lib/cycle/refs.mjs').RefContext} */
  const ctx = { root, gates, qa: null };

  /** @type {string[]} */
  const sections = [];

  if (escalation !== null) sections.push(renderEscalationBanner(escalation));

  // Что сделано: пункты из артефактов прохода и обязательная ссылка на issue.
  const doneLines = ['## Что сделано', ''];
  if (summary.length > 0) doneLines.push(...summary.map((item) => `- ${redacted(item)}`), '');
  doneLines.push(`Closes #${state.issue}`);
  sections.push(doneLines.join('\n'));

  // Как проверять: что осталось на человека по исходам гейтов.
  const manual = gateEntries.filter((gate) => gate.status !== 'pass' && gate.status !== 'skipped');
  const howLines = ['## Как проверять', ''];
  if (manual.length === 0) {
    howLines.push('Все гейты пройдены или неприменимы: ручных шагов нет.');
  } else {
    howLines.push('Гейты, по которым нужен ручной шаг:', '');
    for (const gate of manual) howLines.push(`- \`${gate.id}\` — ${gate.status}${gateNote(gate)}`);
  }
  sections.push(howLines.join('\n'));

  // Проверки: факты gates.<n>.json, а не статичный список команд.
  const checkLines = ['## Проверки', ''];
  if (gateEntries.length === 0) {
    checkLines.push('Гейты не запускались.');
  } else {
    for (const gate of gateEntries) {
      const checked = gate.status === 'pass' || gate.status === 'skipped';
      checkLines.push(
        `- [${checked ? 'x' : ' '}] \`${gate.id}\` — ${gate.status}${gateNote(gate)}`,
      );
    }
  }
  const integrityLines = integrityFacts(integrity);
  if (integrityLines.length > 0) checkLines.push('', ...integrityLines);
  sections.push(checkLines.join('\n'));

  // Независимая оценка (§5.7).
  const positiveReview = review.verdict === REVIEW_POSITIVE;
  const positiveEvaluation = EVALUATION_POSITIVE.includes(evaluation.verdict);
  const evaluationLines = [
    '## Независимая оценка',
    '',
    '### Вердикты',
    '',
    '| Источник | Вердикт |',
    '| --- | --- |',
    `| Ревью | \`${review.verdict}\` |`,
    `| Оценка | \`${evaluation.verdict}\` |`,
    '',
  ];
  if (positiveReview !== positiveEvaluation) {
    evaluationLines.push(
      `Расхождение: ревью — \`${review.verdict}\`, оценка — \`${evaluation.verdict}\`.`,
      '',
    );
  }
  evaluationLines.push(`Итераций: ${state.iteration} из ${state.max_iterations}.`, '');

  const evaluationCriteria = Array.isArray(evaluation.criteria) ? evaluation.criteria : [];
  /** @type {Map<string, Record<string, any>>} первое вхождение id: порядок задаёт criteria.md */
  const criteriaById = new Map();
  for (const criterion of evaluationCriteria) {
    if (!criteriaById.has(criterion.id)) criteriaById.set(criterion.id, criterion);
  }

  // Полнота оценивания: критерий из `criteria.md` без статуса — ошибка сборки тела PR
  // (код 2), а не строка со `—`: PR обязан показывать статус каждого критерия.
  const unrated = criteria.filter((criterion) => !criteriaById.has(criterion.id));
  if (unrated.length > 0) {
    throw new Error(
      `evaluation.criteria: нет статуса для критериев из ${CRITERIA_FILE}: ${unrated
        .map((criterion) => criterion.id)
        .join(', ')}`,
    );
  }

  evaluationLines.push(
    '### Критерии',
    '',
    '| Критерий | Статус | Свидетельство |',
    '| --- | --- | --- |',
  );
  /** @type {string[]} */
  const partial = [];
  /** @type {string[]} */
  const unverifiedCriteria = [];
  for (const criterion of criteria) {
    const rated = /** @type {Record<string, any>} */ (criteriaById.get(criterion.id));
    const { status } = rated;
    if (status === 'partial') partial.push(criterion.id);
    if (status === 'unverified') unverifiedCriteria.push(criterion.id);
    evaluationLines.push(
      `| ${criterion.id}: ${cell(criterion.text)} | ${status} | ${evidenceCell(rated, ctx)} |`,
    );
  }
  if (partial.length > 0) {
    evaluationLines.push('', `Частично (\`partial\`): ${partial.join(', ')}.`);
  }
  if (unverifiedCriteria.length > 0) {
    evaluationLines.push('', `Не проверено (\`unverified\`): ${unverifiedCriteria.join(', ')}.`);
  }

  const findings = Array.isArray(review.findings) ? review.findings : [];
  if (findings.length > 0) {
    evaluationLines.push('', '### Замечания ревью', '');
    for (const finding of findings) {
      // `id` находки — тоже непустая строка из артефакта без шаблона в схеме: маскируется.
      evaluationLines.push(
        `- \`${redacted(finding.id)}\` [${finding.severity}] ${redacted(finding.summary)}`,
      );
    }
  }

  if (decision.action === PROCEED_WITH_UNVERIFIED) {
    evaluationLines.push('', '### Не проверено (снять может владелец)', '');

    const decisionItems = Array.isArray(decision.unverified) ? decision.unverified : [];
    const evaluationUnverified = Array.isArray(evaluation.unverified) ? evaluation.unverified : [];

    // Один факт приходит из двух артефактов (`evaluation unverified: …` и `what — why`):
    // дедупликация до маскирования-независимой разметки, чтобы чекбоксов не было вдвое.
    const unchecked = dedupeUnverified([
      ...decisionItems.map((item) => redacted(item)),
      ...evaluationUnverified.map((item) => `${redacted(item.what)} — ${redacted(item.why)}`),
    ]).map((item) => `- [ ] ${item}`);

    if (unchecked.length === 0) evaluationLines.push('Отметок нет.');
    else evaluationLines.push(...unchecked);
  }
  sections.push(evaluationLines.join('\n'));

  // Риски: пункты шаблона PR (§5.7), их отмечает человек.
  const riskLines = ['## Риски', ''];
  if (risks === null || risks.length === 0) {
    riskLines.push(
      'Пунктов нет: раздел заполняет человек по шаблону PR (`paths.prTemplate`), в шаблоне их нет.',
    );
  } else {
    riskLines.push(...risks);
  }
  sections.push(riskLines.join('\n'));

  // Вне скоупа: пункты followups.md; файла нет — заглушка, а не ошибка.
  const followupLines = ['## Вне скоупа', ''];
  if (followups.length === 0) followupLines.push('Нет пунктов вне скоупа.');
  else followupLines.push(...followups.map((item) => `- ${redacted(item)}`));
  sections.push(followupLines.join('\n'));

  return `${sections.join('\n\n')}\n`;
}

/**
 * Разбирает аргументы командной строки. Любой мусор — ошибка использования (код 2).
 * @param {string[]} argv
 * @returns {{ dir: string|null, draftEscalation: boolean }}
 */
export function parseArgs(argv) {
  /** @type {string|null} */
  let dir = null;
  let draftEscalation = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) break;
    if (arg === '--dir') {
      const value = argv[index + 1];
      if (!isText(value) || value.startsWith('--')) {
        throw new Error('--dir: ожидается путь к каталогу цикла');
      }
      dir = value;
      index += 1;
      continue;
    }
    if (arg === '--draft-escalation') {
      draftEscalation = true;
      continue;
    }
    throw new Error(`неизвестный аргумент: ${arg}`);
  }

  return { dir, draftEscalation };
}

/**
 * Читает обязательный JSON-артефакт и проверяет схему. Отсутствие или порча — отказ
 * (код 2): без артефакта соответствующий раздел PR был бы выдуманным.
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
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: не читается как JSON (${file}): ${reason}`, { cause: error });
  }

  const result = validator(doc);
  if (!result.ok) {
    throw new Error(`${label}: схема нарушена (${file}):\n${result.errors.join('\n')}`);
  }
  return /** @type {Record<string, any>} */ (doc);
}

/**
 * Читает необязательный JSON-артефакт: отсутствие файла — `null`, порча — отказ
 * (повреждённый артефакт нельзя молча показать пустым разделом).
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
 * Обязательный текстовый артефакт (`evidence/criteria.md`).
 * @param {string} file
 * @param {string} label
 * @returns {string}
 */
function readRequiredText(file, label) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: не читается (${file}): ${reason}`, { cause: error });
  }
}

/**
 * Пункты «Риски» из шаблона PR проекта (`paths.prTemplate`). Пустой путь, отсутствующий файл
 * или шаблон без раздела — `null`: раздел PR печатается с пометкой, чужой список не подставляется.
 * @param {string} root корень репозитория
 * @param {string} prTemplate путь шаблона из конфига (относительный или абсолютный)
 * @returns {string[]|null}
 */
function templateRisks(root, prTemplate) {
  if (!isText(prTemplate)) return null;

  const path = resolve(root, prTemplate);
  if (!existsSync(path)) return null;

  const items = riskItems(readFileSync(path, 'utf8'));
  return items.length > 0 ? items : null;
}

/**
 * Точка входа CLI. На диск ничего не пишет: единственный вывод — тело PR в stdout,
 * диагностика — в stderr.
 * @returns {void}
 */
function main() {
  try {
    const cli = takeConfigOption(process.argv.slice(2));
    const args = parseArgs(cli.argv);
    const root = repoRoot();
    const config = loadConfig(root, { file: cli.file });
    const dir = args.dir === null ? findActiveCycle() : resolve(args.dir);

    const state = readRequiredJson(join(dir, FIXED_NAMES.state), validateState, FIXED_NAMES.state);
    const names = iterNames(state.iteration);

    const gates = readRequiredJson(join(dir, names.gates), validateGates, names.gates);
    const review = readRequiredJson(join(dir, names.reviewJson), validateReview, names.reviewJson);
    const evaluation = readRequiredJson(
      join(dir, names.evaluationJson),
      validateEvaluation,
      names.evaluationJson,
    );
    const decision = readRequiredJson(join(dir, names.decision), validateDecision, names.decision);

    const criteria = parseCriteria(
      readRequiredText(join(dir, FIXED_NAMES.evidenceDir, CRITERIA_FILE), CRITERIA_FILE),
    );
    if (criteria.length === 0) {
      throw new Error(`${CRITERIA_FILE}: нет строк вида «- C1: формулировка»`);
    }
    // Тело PR публикует цель: критерии, отличные от замороженных, показывать нельзя (#22).
    if (criteriaMismatch(criteria, state) !== null) {
      throw new Error(
        `${CRITERIA_FILE}: критерии не совпадают с замороженными (criteria_drift): ` +
          'тело PR собиралось бы по чужой цели',
      );
    }

    const escalation = args.draftEscalation
      ? readOptionalJson(
          join(dir, FIXED_NAMES.escalation),
          validateEscalation,
          FIXED_NAMES.escalation,
        )
      : null;
    const followupsPath = join(dir, FIXED_NAMES.followups);
    const followups = existsSync(followupsPath)
      ? listItems(readFileSync(followupsPath, 'utf8'))
      : [];
    const risks = templateRisks(root, config.paths.prTemplate);
    // Файла нет — секция `integrity` не настроена или пакет собран до неё; строка в PR
    // тогда не печатается. Битый файл — отказ (код 2), как у остальных артефактов.
    const integrity = readOptionalJson(
      join(dir, config.paths.evidenceDir, INTEGRITY_FILE),
      validateIntegrity,
      INTEGRITY_FILE,
    );

    const body = renderPrBody({
      state,
      gates,
      review,
      evaluation,
      decision,
      criteria,
      summary: summaryItems(dir, names),
      followups,
      escalation,
      risks,
      integrity,
      root,
      gateIds: config.gates.map((gate) => gate.id),
    });
    process.stdout.write(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cycle-pr-body: ${message}\n`);
    process.exitCode = 2;
  }
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) main();
