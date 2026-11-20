#!/usr/bin/env node
/**
 * `cycle-driver` — детерминированная маршрутизация стадий цикла (issue #47, «фаза 3» §17).
 *
 * Зачем: маршрутизацию вёл LLM-супервизор по промпту, то есть persuasion. Здесь решение
 * «какая стадия следующая и что делать» принимает код: по `state.json`, наличию артефактов и
 * `decision.<n>.json`. Супервизор остаётся исполнителем — запускает то, что вернул драйвер,
 * и не решает сам.
 *
 * Подкоманды:
 *
 * ```
 * next [--dir D] [--root R] [--json]   что делать прямо сейчас; ничего не пишет и не меняет
 * run  [--dir D] [--root R] [--max-steps N]  исполнить детерминированные шаги подряд
 * ```
 *
 * `next` возвращает дескриптор шага (`lib/cycle/driver.mjs`): `action` — что делать, `step` —
 * какой детерминированный скрипт, `target` — стадия перехода, `spawn` — кому передать работу,
 * `commands` — готовые команды для человека и супервизора. `run` исполняет `run`/`advance`/
 * `finish` шаги и останавливается на `spawn`/`handoff`/`stop`/`blocked`: работу модели драйвер
 * не изобретает.
 *
 * Побочный эффект у обеих подкоманд один — журнал `driver.jsonl` в каталоге цикла: запись
 * каждого отличающегося от предыдущего решения (повторный `next` на том же дереве журнал не
 * растит). `state.json` и артефакты цикла драйвер не меняет; журнал — телеметрия для блока
 * `driver` в `metrics.json` (#47), а не артефакт протокола.
 *
 * Драйвер — не писатель состояния: он зовёт `cycle-state` (единственный писатель `state.json`)
 * и остальные скрипты цикла как подпроцессы. Команды печатаются путями относительно корня
 * репозитория, поэтому их можно скопировать в терминал.
 *
 * Коды выхода: `0` — шаг определён или исполнен, `1` — протокол требует решения человека
 * (`blocked`), `2` — ошибка использования или данных, `3` — конфликт состояния, `4` —
 * `diff_too_large` от `cycle-evidence`. Коды подпроцессов не переупаковываются: если упал
 * `cycle-gates` с кодом 2, драйвер выходит с 2 и печатает, что исполнил.
 *
 * Shebang нужен: файл запускается как `node scripts/cycle-driver.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectRun } from './lib/cycle/cli.mjs';
import { loadConfig } from './lib/cycle/config.mjs';
import { CRITERIA_FILE } from './lib/cycle/criteria.mjs';
import {
  buildJournalEntry,
  describeStep,
  isExecutable,
  parseJournal,
  planStep,
  sameAnswer,
} from './lib/cycle/driver.mjs';
import { changedFiles } from './lib/cycle/git.mjs';
import { readJson } from './lib/cycle/io.mjs';
import {
  FIXED_NAMES,
  artifactsDir,
  findActiveCycle,
  iterNames,
  repoRoot,
} from './lib/cycle/paths.mjs';
import { validateDecision, validateState } from './lib/cycle/validate.mjs';
import { diffTouchesWeb } from './cycle-decide.mjs';
import { EVIDENCE_FILES } from './cycle-evidence.mjs';

/** Каталог скриптов цикла: команды печатаются относительно корня репозитория. */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Подкоманды. */
const COMMANDS = Object.freeze(['next', 'run']);

/** Сколько шагов `run` исполняет за один вызов, если не задано иное. */
const DEFAULT_MAX_STEPS = 20;

/** Подкоманды, которые исполняет драйвер: `run`/`advance`/`finish` из дескриптора. */
const GATE_TOLERATED_CODE = 1;

/** Класс ошибки использования: код 2. */
export class UsageError extends Error {}

/**
 * Разбирает аргументы командной строки.
 * @param {string[]} argv аргументы без имени скрипта
 * @returns {{ command: string, dir: string|null, root: string|null, maxSteps: number }}
 */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || !COMMANDS.includes(command)) {
    throw new UsageError(`ожидается подкоманда: ${COMMANDS.join('|')}`);
  }

  /** @type {string|null} */
  let dir = null;
  /** @type {string|null} */
  let root = null;
  let maxSteps = DEFAULT_MAX_STEPS;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--dir' || arg === '--root') {
      const value = rest[index + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
        throw new UsageError(`${arg}: ожидается путь`);
      }
      if (arg === '--dir') dir = value;
      else root = value;
      index += 1;
      continue;
    }
    if (arg === '--max-steps') {
      const value = rest[index + 1];
      const parsed = Number(value);
      if (typeof value !== 'string' || !Number.isInteger(parsed) || parsed < 1) {
        throw new UsageError('--max-steps: ожидается целое число ≥ 1');
      }
      maxSteps = parsed;
      index += 1;
      continue;
    }
    throw new UsageError(`неизвестный аргумент: ${arg}`);
  }

  return { command, dir, root, maxSteps };
}

/**
 * Присутствие артефактов на диске. Один проход по файлам: планировщик решает по флагам, а не
 * по файловой системе, поэтому его можно тестировать без временных каталогов.
 * @param {string} dir каталог цикла
 * @param {string} artifactsDir каталог артефактов (там лежит `.lock`)
 * @param {ReturnType<typeof loadConfig>} config конфиг проекта
 * @param {number} iteration номер итерации
 * @param {boolean} webDiff дифф затрагивает web-приложение
 * @returns {import('./lib/cycle/driver.mjs').DriverArtifacts}
 */
export function readArtifacts(dir, artifactsDir, config, iteration, webDiff) {
  const names = iterNames(iteration);
  const evidenceDir = join(dir, config.paths.evidenceDir);

  /** @type {Record<string, any>|null} */
  let decisionDoc = null;
  const decisionFile = join(dir, names.decision);
  if (existsSync(decisionFile)) {
    const raw = readJson(decisionFile);
    const verdict = validateDecision(raw);
    decisionDoc = verdict.ok ? /** @type {Record<string, any>} */ (raw) : null;
  }

  return {
    criteria: existsSync(join(evidenceDir, CRITERIA_FILE)),
    plan: existsSync(join(dir, names.plan)),
    codeReport: existsSync(join(dir, names.codeReport)),
    gates: existsSync(join(dir, names.gates)),
    qaWeb: existsSync(join(dir, FIXED_NAMES.qaWeb)),
    evidence: existsSync(join(evidenceDir, EVIDENCE_FILES.diff)),
    review: existsSync(join(dir, names.reviewMd)),
    evaluation: existsSync(join(dir, names.evaluationMd)),
    decision: decisionDoc !== null,
    reworkBrief: existsSync(join(dir, names.reworkBrief)),
    followups: existsSync(join(dir, 'followups.md')),
    metrics: existsSync(join(dir, FIXED_NAMES.metrics)),
    lock: existsSync(join(artifactsDir, '.lock')),
    webDiff,
    decisionDoc,
  };
}

/**
 * Путь для вставки в команду: без кавычек, если безопасен, иначе в кавычках JSON.
 * @param {string} value путь
 * @returns {string}
 */
function quote(value) {
  return /^[\w./@+-]+$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Команды для токена шага. Возвращает готовые строки — их печатают и исполняют.
 * @param {import('./lib/cycle/driver.mjs').DriverStep} step дескриптор шага
 * @param {string} dir каталог цикла
 * @param {string} root корень репозитория
 * @returns {string[]}
 */
export function renderCommands(step, dir, root) {
  /** @param {string} name имя скрипта */
  const script = (name) => relative(root, join(SCRIPT_DIR, name));
  const dirFlag = `--dir ${quote(dir)}`;

  if (step.action === 'advance') {
    return [`node ${script('cycle-state.mjs')} advance --to ${step.target} ${dirFlag}`];
  }

  if (step.action === 'finish') {
    return [
      `node ${script('cycle-state.mjs')} finish --stage ${step.target} --status done ${dirFlag}`,
    ];
  }

  switch (step.step) {
    case 'criteria':
      return [
        `node ${script('cycle-evidence.mjs')} criteria ${dirFlag} ` +
          `--issue-json ${quote(join(dir, FIXED_NAMES.issue))}`,
      ];
    case 'freeze-criteria':
      return [`node ${script('cycle-state.mjs')} freeze-criteria ${dirFlag}`];
    case 'gates': {
      const only = step.gate === null ? '' : ` --only ${step.gate}`;
      return [`node ${script('cycle-gates.mjs')}${only} ${dirFlag}`];
    }
    case 'packet':
      return [`node ${script('cycle-evidence.mjs')} packet ${dirFlag}`];
    case 'decide':
      return [`node ${script('cycle-decide.mjs')} ${dirFlag}`];
    case 'apply-decision':
      return [`node ${script('cycle-state.mjs')} apply-decision ${dirFlag}`];
    case 'metrics':
      return [`node ${script('cycle-metrics.mjs')} ${dirFlag}`];
    case 'unlock':
      return [`node ${script('cycle-state.mjs')} unlock ${dirFlag}`];
    default:
      return [];
  }
}

/**
 * Дифф от базы цикла затрагивает web-приложение. Ошибка git — не «нет диффа»: битая база
 * делает маршрутизацию неверной, поэтому отказ явный (код 2).
 * @param {string} base база цикла
 * @param {string} root корень репозитория
 * @param {ReturnType<typeof loadConfig>} config конфиг проекта
 * @returns {boolean}
 */
export function readWebDiff(base, root, config) {
  try {
    return diffTouchesWeb(changedFiles(base, { cwd: root }), config.qaWeb.pathPrefixes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`не удалось прочитать дифф от base_sha ${base}: ${message}`);
  }
}

/**
 * Собирает дескриптор шага по текущему состоянию каталога.
 * @param {{ dir: string, root: string, config: ReturnType<typeof loadConfig> }} context
 * @returns {import('./lib/cycle/driver.mjs').DriverStep}
 */
export function nextStep({ dir, root, config }) {
  const stateFile = join(dir, FIXED_NAMES.state);
  if (!existsSync(stateFile)) {
    throw new UsageError(`state.json не найден: ${stateFile}`);
  }
  const raw = readJson(stateFile);
  const verdict = validateState(raw);
  if (!verdict.ok) {
    throw new UsageError(`state.json не прошёл проверку: ${verdict.errors.join('; ')}`);
  }
  const state = /** @type {import('./lib/cycle/driver.mjs').DriverState} */ (raw);

  const artifactsDir = dirname(resolve(dir));
  const base = typeof state.base_sha === 'string' ? state.base_sha : null;
  const webDiff = base === null ? false : readWebDiff(base, root, config);

  const artifacts = readArtifacts(dir, artifactsDir, config, state.iteration, webDiff);
  return planStep({ state, artifacts });
}

/**
 * Печатает дескриптор в stdout как JSON с готовыми командами.
 * @param {import('./lib/cycle/driver.mjs').DriverStep} step дескриптор
 * @param {string} dir каталог цикла
 * @param {string} root корень репозитория
 * @returns {Record<string, unknown>}
 */
function withCommands(step, dir, root) {
  return { ...step, commands: renderCommands(step, dir, root) };
}

/**
 * Журнал решений драйвера. Нет файла — нет решений (цикл шёл без драйвера): это не ошибка,
 * а факт, который `metrics.json` покажет как `driver: null`.
 * @param {string} file путь к `driver.jsonl`
 * @returns {import('./lib/cycle/driver.mjs').DriverJournalEntry[]}
 */
export function readJournal(file) {
  if (!existsSync(file)) return [];
  return parseJournal(readFileSync(file, 'utf8'));
}

/**
 * Дописывает решение в журнал, если оно отличается от предыдущего. Ошибка записи журнала не
 * отменяет маршрутизацию: телеметрия не важнее шага, поэтому отказ идёт в stderr.
 * @param {string} file путь к `driver.jsonl`
 * @param {import('./lib/cycle/driver.mjs').DriverJournalEntry[]} entries накопленный журнал
 * @param {import('./lib/cycle/driver.mjs').DriverStep} step дескриптор решения
 * @returns {void}
 */
function recordStep(file, entries, step) {
  const previous = entries.at(-1) ?? null;
  const entry = buildJournalEntry({ step, at: new Date().toISOString(), previous });
  if (previous !== null && sameAnswer(entry, previous)) return;
  try {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cycle-driver: журнал не записан: ${message}\n`);
    return;
  }
  entries.push(entry);
}

/**
 * Исполняет одну команду. stdout подпроцесса захватывается, а не наследуется: каждый скрипт
 * ядра печатает JSON, и в общем stdout он смешался бы с отчётом драйвера. stderr идёт как
 * есть — диагностика должна быть видна.
 * @param {string} command команда
 * @param {string} root корень репозитория
 * @returns {{ code: number, output: string }} код выхода и stdout подпроцесса
 */
function execute(command, root) {
  try {
    const stdout = execFileSync('sh', ['-c', command], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    });
    return { code: 0, output: stdout.trim() };
  } catch (error) {
    const failure = /** @type {{ status?: number|null, stdout?: string }} */ (error);
    const code = typeof failure.status === 'number' ? failure.status : 2;
    const output = typeof failure.stdout === 'string' ? failure.stdout.trim() : '';
    return { code, output };
  }
}

/**
 * Точка входа CLI.
 * @returns {number} код выхода
 */
function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root === null ? repoRoot() : resolve(args.root);
  const config = loadConfig(root);

  /** @type {string} */
  let dir;
  if (args.dir === null) {
    dir = findActiveCycle(artifactsDir(root));
  } else {
    dir = resolve(args.dir);
  }

  const journalFile = join(dir, FIXED_NAMES.driverJournal);
  /** @type {import('./lib/cycle/driver.mjs').DriverJournalEntry[]} */
  let journal;
  try {
    journal = readJournal(journalFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(message);
  }

  if (args.command === 'next') {
    const step = nextStep({ dir, root, config });
    recordStep(journalFile, journal, step);
    process.stdout.write(`${JSON.stringify(withCommands(step, dir, root), null, 2)}\n`);
    return step.action === 'blocked' ? 1 : 0;
  }

  /** @type {{ command: string, code: number, output: string }[]} */
  const executed = [];
  let count = 0;
  for (;;) {
    const step = nextStep({ dir, root, config });
    recordStep(journalFile, journal, step);
    if (!isExecutable(step)) {
      process.stdout.write(
        `${JSON.stringify({ driver: 'run', dir, executed, next: withCommands(step, dir, root) }, null, 2)}\n`,
      );
      return step.action === 'blocked' ? 1 : 0;
    }
    if (count >= args.maxSteps) {
      process.stdout.write(
        `${JSON.stringify({ driver: 'run', dir, executed, error: `лимит шагов (${args.maxSteps}) исчерпан` }, null, 2)}\n`,
      );
      return 1;
    }
    const commands = renderCommands(step, dir, root);
    if (commands.length === 0) {
      process.stdout.write(
        `${JSON.stringify({ driver: 'run', dir, executed, error: `шаг без команды: ${step.step}` }, null, 2)}\n`,
      );
      return 2;
    }
    for (const command of commands) {
      const { code, output } = execute(command, root);
      executed.push({ command, code, output });
      const tolerated = step.step === 'gates' && code === GATE_TOLERATED_CODE;
      if (code !== 0 && !tolerated) {
        process.stdout.write(
          `${JSON.stringify({ driver: 'run', dir, executed, error: describeStep(step) }, null, 2)}\n`,
        );
        return code;
      }
    }
    count += 1;
  }
  return 1;
}

if (isDirectRun(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cycle-driver: ${message}\n`);
    process.exitCode = 2;
  }
}
