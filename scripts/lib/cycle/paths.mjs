/**
 * Раскладка артефактов цикла `/cycle` (docs/orchestrator-core.md §5.1–5.2).
 *
 * Модуль отвечает только за пути и имена: корень репозитория, каталог `.pi/artifacts/`,
 * имена файлов итерации и поиск активного цикла. Логики этапов и записи файлов здесь нет.
 * Shebang не нужен: модуль подключается из CLI-скриптов `cycle-*.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { loadConfig } from './config.mjs';
import { readJson } from './io.mjs';

/** Завершённые этапы: каталог с таким `stage` активным циклом не считается. */
const FINISHED_STAGES = new Set(['DONE', 'ESCALATED']);

/** Имена внутри каталога цикла, не зависящие от номера итерации. */
export const FIXED_NAMES = Object.freeze({
  state: 'state.json',
  followups: 'followups.md',
  metrics: 'metrics.json',
  usage: 'usage.json',
  escalation: 'escalation.json',
  qaWeb: 'qa-web.json',
  issue: 'issue.json',
  evidenceDir: 'evidence',
  // Журнал решений `cycle-driver` (#47): телеметрия маршрутизации, вход блока `driver` в
  // `metrics.json`. Не артефакт протокола: никто, кроме драйвера, его не читает.
  driverJournal: 'driver.jsonl',
});

/**
 * Корень репозитория — единственный источник истины для всех относительных путей.
 * @returns {string} абсолютный путь без завершающего слэша
 */
export function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

/**
 * Каталог артефактов цикла. Путь берётся из конфига проекта (`paths.artifactsDir`),
 * по умолчанию `.pi/artifacts`.
 * @param {string} [root] корень репозитория; по умолчанию определяется через git
 * @param {ReturnType<typeof loadConfig>} [config] конфиг проекта; по умолчанию загружается
 * @returns {string}
 */
export function artifactsDir(root = repoRoot(), config = loadConfig(root)) {
  return join(root, config.paths.artifactsDir);
}

/**
 * @typedef {object} CycleDirNameParams
 * @property {string} date дата начала цикла, `YYYY-MM-DD`
 * @property {number|string} issue номер issue
 * @property {string} slug короткий латинский идентификатор задачи
 */

/**
 * Имя каталога цикла: `<date>-<issue>-<slug>` (как в `.pi/artifacts/`).
 * @param {CycleDirNameParams} params
 * @returns {string}
 */
export function cycleDirName({ date, issue, slug }) {
  return `${date}-${issue}-${slug}`;
}

/**
 * Имена файлов с номером итерации. Нумерация с единицы: `<name>.<n>.<ext>`.
 * @param {number} iteration номер итерации, целое ≥ 1
 * @returns {{
 *   plan: string,
 *   codeReport: string,
 *   reworkBrief: string,
 *   reviewMd: string,
 *   reviewJson: string,
 *   evaluationMd: string,
 *   evaluationJson: string,
 *   decision: string,
 *   gates: string,
 *   manifest: string,
 * }}
 */
export function iterNames(iteration) {
  if (!Number.isInteger(iteration) || iteration < 1) {
    throw new Error(`номер итерации должен быть целым ≥ 1, получено: ${iteration}`);
  }
  return {
    plan: `plan.${iteration}.md`,
    codeReport: `code-report.${iteration}.md`,
    reworkBrief: `rework-brief.${iteration}.md`,
    reviewMd: `review.${iteration}.md`,
    reviewJson: `review.${iteration}.json`,
    evaluationMd: `evaluation.${iteration}.md`,
    evaluationJson: `evaluation.${iteration}.json`,
    decision: `decision.${iteration}.json`,
    gates: `gates.${iteration}.json`,
    // Снимок размера пакета `evidence/` (ADR 0009, #106): телеметрия в каталоге цикла, а не
    // в пакете оценщика — по тому же правилу, что и `driver.jsonl` (#47).
    manifest: `manifest.${iteration}.json`,
  };
}

/**
 * Единственный активный цикл в каталоге артефактов: подкаталог со `state.json`,
 * у которого `stage` не `DONE` и не `ESCALATED`. Ноль или несколько — ошибка:
 * неоднозначность должна ломать цикл, а не разрешаться угадыванием.
 * @param {string} [dir] каталог артефактов; по умолчанию `.pi/artifacts/` репозитория
 * @returns {string} путь к каталогу активного цикла
 */
export function findActiveCycle(dir = artifactsDir()) {
  /** @type {string[]} */
  const active = [];

  // Каталога артефактов ещё нет — это не сбой файловой системы, а «цикл не начат» (#198):
  // `readdirSync` бросал `ENOENT: … scandir`, и первый запуск читался как поломка программы.
  // Каталог создаёт первый же `cycle-state init`, поэтому ответ — команда старта.
  if (!existsSync(dir)) {
    throw new Error(
      `цикл не инициализирован: каталога артефактов нет (${dir}). Начните цикл: ` +
        'cycle-state init --issue <номер> --slug <slug> --branch <тип>/<номер>-<slug>',
    );
  }

  for (const name of readdirSync(dir).sort()) {
    const candidate = join(dir, name);
    if (!statSync(candidate).isDirectory()) continue;

    const statePath = join(candidate, FIXED_NAMES.state);
    if (!existsSync(statePath)) continue;

    const state = /** @type {{ stage?: string }} */ (readJson(statePath));
    if (state.stage && FINISHED_STAGES.has(state.stage)) continue;
    active.push(candidate);
  }

  if (active.length === 0) {
    throw new Error(
      `активный цикл не найден в ${dir}: нет каталога со ${FIXED_NAMES.state} и незавершённым stage`,
    );
  }
  if (active.length > 1) {
    const names = active.map((path) => basename(path)).join(', ');
    throw new Error(`активных циклов больше одного в ${dir}: ${names}`);
  }
  const only = active[0];
  if (only === undefined) {
    // Недостижимо: пустой список отсечён выше. Проверка нужна, чтобы тип не был `undefined`.
    throw new Error(`активный цикл не найден в ${dir}`);
  }
  return only;
}
