import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { criteriaDigest, parseCriteria } from './lib/cycle/criteria.mjs';

const CLI = fileURLToPath(new URL('./cycle-driver.mjs', import.meta.url));
const METRICS_CLI = fileURLToPath(new URL('./cycle-metrics.mjs', import.meta.url));
const GATES_FIXTURE = fileURLToPath(new URL('./fixtures/cycle/gates.valid.json', import.meta.url));
const STATE_FIXTURE = fileURLToPath(new URL('./fixtures/cycle/state.valid.json', import.meta.url));
const DECISION_FIXTURE = fileURLToPath(
  new URL('./fixtures/cycle/decision.valid.json', import.meta.url),
);
const REVIEW_FIXTURE = fileURLToPath(new URL('./fixtures/cycle/review.valid.md', import.meta.url));
const EVALUATION_FIXTURE = fileURLToPath(
  new URL('./fixtures/cycle/evaluation.valid.md', import.meta.url),
);

/**
 * Запускает CLI драйвера.
 * @param {string[]} args
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Отчёт `run`: исполненные команды и следующий шаг.
 * @typedef {object} RunReport
 * @property {string} driver
 * @property {string} dir
 * @property {{ command: string, code: number, output: string }[]} executed
 * @property {import('./lib/cycle/driver.mjs').DriverStep & { commands: string[] }} [next]
 * @property {string} [error]
 */

/**
 * Разбирает stdout `run` в типизированный отчёт.
 * @param {string} stdout
 * @returns {RunReport}
 */
function parseRun(stdout) {
  return /** @type {RunReport} */ (JSON.parse(stdout));
}

/**
 * Временный репозиторий с одним коммитом: драйверу нужны `git diff` и корень.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function makeRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-driver-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  /** @param {string[]} args */
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.email', 'driver@example.com');
  git('config', 'user.name', 'Driver Test');
  writeFileSync(join(dir, 'README.md'), 'driver test\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return dir;
}

/**
 * Кладёт `state.json` в каталог цикла и возвращает его путь.
 * @param {string} repo
 * @param {Record<string, unknown>} overrides
 * @param {string} [name]
 * @returns {{ dir: string, state: string }}
 */
function writeCycle(repo, overrides, name = '2026-11-20-99-driver') {
  const dir = join(repo, '.pi', 'artifacts', name);
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  const base = JSON.parse(readFileSync(STATE_FIXTURE, 'utf8'));
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).stdout.trim();
  const state = { ...base, base_sha: sha, ...overrides };
  const file = join(dir, 'state.json');
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  return { dir, state: file };
}

/**
 * Читает `state.json` после прогона.
 * @param {string} file
 * @returns {Record<string, any>}
 */
function readState(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('cycle-driver next', () => {
  test('INIT без критериев — добыча критериев', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, {
      stage: 'INIT',
      stage_status: 'done',
      criteria_sha256: null,
    });

    const result = runCli(['next', '--dir', dir, '--root', repo]);
    assert.equal(result.code, 0, result.stderr);
    const step = JSON.parse(result.stdout);
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'criteria');
    assert.match(step.commands[0], /cycle-evidence\.mjs criteria/u);
    assert.match(step.commands[0], /--issue-json/u);
  });

  test('INIT с замороженными критериями — переход в PLAN', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'INIT', stage_status: 'done' });
    mkdirSync(join(dir, 'evidence'), { recursive: true });
    writeFileSync(join(dir, 'evidence', 'criteria.md'), '# критерии\n');

    const result = runCli(['next', '--dir', dir, '--root', repo]);
    assert.equal(result.code, 0, result.stderr);
    const step = JSON.parse(result.stdout);
    assert.equal(step.action, 'advance');
    assert.equal(step.target, 'PLAN');
    assert.match(step.commands[0], /advance --to PLAN/u);
  });

  test('PLAN без плана — передача субагенту', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'PLAN', stage_status: 'running' });

    const result = runCli(['next', '--dir', dir, '--root', repo]);
    const step = JSON.parse(result.stdout);
    assert.equal(step.action, 'spawn');
    assert.equal(step.reason, 'plan_missing');
    assert.equal(step.commands.length, 0);
  });

  test('GATES с закрытой стадией — переход по таблице', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'GATES', stage_status: 'done' });

    const step = JSON.parse(runCli(['next', '--dir', dir, '--root', repo]).stdout);
    assert.equal(step.action, 'advance');
    assert.equal(step.target, 'REVIEW');
    assert.equal(step.reason, 'no_web_diff');
  });

  test('ACQUIRE_EVIDENCE с гейтом в решении — добор через GATES', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'ACQUIRE_EVIDENCE', stage_status: 'done' });
    const decision = JSON.parse(readFileSync(DECISION_FIXTURE, 'utf8'));
    writeFileSync(
      join(dir, 'decision.1.json'),
      `${JSON.stringify({ ...decision, action: 'ACQUIRE_EVIDENCE', reasons: ['gate:unit: fail'], acquire: ['gate:unit'] }, null, 2)}\n`,
    );

    const step = JSON.parse(runCli(['next', '--dir', dir, '--root', repo]).stdout);
    assert.equal(step.action, 'advance');
    assert.equal(step.target, 'GATES');
    assert.equal(step.reason, 'acquire_gate');
  });

  test('DONE без metrics — метрики, затем стоп', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'DONE', stage_status: 'running' });

    const step = JSON.parse(runCli(['next', '--dir', dir, '--root', repo]).stdout);
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'metrics');
    assert.match(step.commands[0], /cycle-metrics\.mjs/u);
  });

  test('стадия с ошибкой — блокировка, код 1', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'CODE', stage_status: 'error' });

    const result = runCli(['next', '--dir', dir, '--root', repo]);
    assert.equal(result.code, 1);
    const step = JSON.parse(result.stdout);
    assert.equal(step.action, 'blocked');
    assert.equal(step.reason, 'stage_error');
  });
});

describe('cycle-driver run', () => {
  test('INIT доводится до PLAN и останавливается на субагенте', (t) => {
    const repo = makeRepo(t);
    const { dir, state } = writeCycle(repo, { stage: 'INIT', stage_status: 'done' });
    mkdirSync(join(dir, 'evidence'), { recursive: true });
    writeFileSync(join(dir, 'evidence', 'criteria.md'), '# критерии\n');

    const result = runCli(['run', '--dir', dir, '--root', repo]);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.executed.length >= 1, 'должен быть исполнен хотя бы один шаг');
    assert.equal(report.executed[0].code, 0);
    assert.equal(report.next.action, 'spawn');
    assert.equal(report.next.stage, 'PLAN');
    assert.equal(readState(state).stage, 'PLAN');
  });

  test('отказ подпроцесса возвращается его кодом и останавливает прогон', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'GATES', stage_status: 'running' });

    const result = runCli(['run', '--dir', dir, '--root', repo]);
    // Гейты в конфиге не заданы: cycle-gates выходит с кодом 2.
    assert.equal(result.code, 2, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.executed[0].code, 2);
    assert.match(report.executed[0].command, /cycle-gates\.mjs/u);
  });

  test('--max-steps ограничивает прогон', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'INIT', stage_status: 'done' });
    mkdirSync(join(dir, 'evidence'), { recursive: true });
    writeFileSync(join(dir, 'evidence', 'criteria.md'), '# критерии\n');

    const result = runCli(['run', '--dir', dir, '--root', repo, '--max-steps', '1']);
    // Один шаг (advance) укладывается в лимит, дальше — остановка на субагенте.
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.executed.length, 1);
  });
});

describe('cycle-driver: отказы', () => {
  test('нет state.json — код 2 и понятное сообщение', (t) => {
    const repo = makeRepo(t);
    const dir = join(repo, '.pi', 'artifacts', 'empty');
    mkdirSync(dir, { recursive: true });

    const result = runCli(['next', '--dir', dir, '--root', repo]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /state\.json не найден/u);
  });

  test('неизвестный аргумент — код 2', (t) => {
    const repo = makeRepo(t);
    const result = runCli(['next', '--bogus', '--root', repo]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /неизвестный аргумент|--bogus/u);
  });

  test('неизвестная подкоманда — код 2', (t) => {
    const repo = makeRepo(t);
    const result = runCli(['plan', '--root', repo]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /подкоманда/u);
  });

  test('битая база цикла — код 2, а не «нет диффа»', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, {
      base_sha: 'f'.repeat(40),
      stage: 'GATES',
      stage_status: 'done',
    });

    const result = runCli(['next', '--dir', dir, '--root', repo]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /base_sha/u);
  });
});

describe('cycle-driver: сквозной прогон GATES → DECIDE', () => {
  /**
   * Репозиторий с гейтом, веткой цикла и состоянием на GATES.
   * @param {import('node:test').TestContext} t
   * @returns {{ repo: string, dir: string, branch: string }}
   */
  function makeGatesCycle(t) {
    const repo = makeRepo(t);
    const branch = 'feat/47-e2e';
    spawnSync('git', ['checkout', '-q', '-b', branch], { cwd: repo });
    mkdirSync(join(repo, '.pi'), { recursive: true });
    writeFileSync(
      join(repo, '.pi', 'harness.config.json'),
      `${JSON.stringify({ gates: [{ id: 'smoke', executable: 'true', args: [] }] }, null, 2)}\n`,
    );

    const { dir } = writeCycle(repo, { stage: 'GATES', stage_status: 'running', branch });
    const criteriaText = '# Критерии\n\n- [ ] работает\n';
    mkdirSync(join(dir, 'evidence'), { recursive: true });
    writeFileSync(join(dir, 'evidence', 'criteria.md'), criteriaText);
    writeFileSync(join(dir, 'evidence', 'issue.md'), '# Задача\n\nПроверить драйвер.\n');

    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    state.criteria_sha256 = criteriaDigest(parseCriteria(criteriaText));
    writeFileSync(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);

    return { repo, dir, branch };
  }

  test('красный гейт не сбой цикла: run идёт дальше к ревью', (t) => {
    const { repo, dir } = makeGatesCycle(t);
    writeFileSync(
      join(repo, '.pi', 'harness.config.json'),
      `${JSON.stringify({ gates: [{ id: 'smoke', executable: 'false', args: [] }] }, null, 2)}\n`,
    );

    const result = runCli(['run', '--dir', dir, '--root', repo]);
    assert.equal(result.code, 0, result.stderr);
    const report = parseRun(result.stdout);
    const gates = report.executed.find((item) => item.command.includes('cycle-gates.mjs'));
    assert.equal(gates?.code, 1, 'упавший гейт вернул 1, и это не остановило драйвер');
    assert.equal(report.next?.stage, 'REVIEW');
    assert.equal(report.next?.action, 'spawn');
  });

  test('run доводит GATES до DECIDE и останавливается на PR', (t) => {
    const { repo, dir } = makeGatesCycle(t);

    // Первый прогон: гейты → REVIEW → пакет свидетельств → передача ревью.
    const first = runCli(['run', '--dir', dir, '--root', repo]);
    assert.equal(first.code, 0, first.stderr);
    const firstReport = parseRun(first.stdout);
    assert.ok(firstReport.next, 'есть следующий шаг');
    assert.equal(firstReport.next.stage, 'REVIEW');
    assert.equal(firstReport.next.action, 'spawn');
    assert.equal(firstReport.next.spawn?.agent, 'review');
    const commands = firstReport.executed.map((item) => item.command);
    assert.ok(
      commands.some((command) => command.includes('cycle-gates.mjs')),
      'гейты прогнаны',
    );
    assert.ok(
      commands.some((command) => command.includes('cycle-evidence.mjs')),
      'пакет собран',
    );

    // Артефакты ревью и оценки кладёт супервизор — драйвер их только читает.
    writeFileSync(join(dir, 'review.1.md'), readFileSync(REVIEW_FIXTURE, 'utf8'));
    writeFileSync(join(dir, 'evaluation.1.md'), readFileSync(EVALUATION_FIXTURE, 'utf8'));

    const second = runCli(['run', '--dir', dir, '--root', repo]);
    assert.equal(second.code, 0, second.stderr);
    const secondReport = parseRun(second.stdout);
    assert.ok(secondReport.next, 'есть следующий шаг');
    assert.equal(secondReport.next.stage, 'PR');
    assert.equal(secondReport.next.action, 'handoff');
    assert.equal(secondReport.next.reason, 'pr_pending');

    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    assert.equal(state.stage, 'PR');
    assert.ok(existsSync(join(dir, 'decision.1.json')), 'решение записано');
  });
});

describe('cycle-driver: идемпотентность и журнал', () => {
  test('повторный next даёт тот же ответ и не растит журнал', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'PLAN', stage_status: 'running' });
    const journal = join(dir, 'driver.jsonl');

    const first = runCli(['next', '--dir', dir, '--root', repo]);
    const second = runCli(['next', '--dir', dir, '--root', repo]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.stdout, first.stdout, 'ответ на том же дереве тот же');

    const entries = readFileSync(journal, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    assert.equal(entries.length, 1, 'повторный вопрос не плодит решений');
    const entry = JSON.parse(/** @type {string} */ (entries[0]));
    assert.equal(entry.action, 'spawn');
    assert.equal(entry.executed, false);
    assert.equal(entry.mismatch, false);
  });

  test('журнал драйвера попадает в metrics.json блоком driver', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'PLAN', stage_status: 'running' });
    runCli(['next', '--dir', dir, '--root', repo]);
    writeFileSync(join(dir, 'gates.1.json'), readFileSync(GATES_FIXTURE, 'utf8'));

    const metrics = spawnSync(process.execPath, [METRICS_CLI, '--dir', dir], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.equal(metrics.status, 0, metrics.stderr);
    const doc = JSON.parse(readFileSync(join(dir, 'metrics.json'), 'utf8'));
    assert.deepEqual(doc.driver, { steps: 1, executed: 0, handed_off: 1, mismatch: 0 });
  });

  test('битый журнал — код 2 и номер строки', (t) => {
    const repo = makeRepo(t);
    const { dir } = writeCycle(repo, { stage: 'PLAN', stage_status: 'running' });
    writeFileSync(join(dir, 'driver.jsonl'), 'не json\n');

    const result = runCli(['next', '--dir', dir, '--root', repo]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /driver\.jsonl: строка 1/u);
  });

  test('конфликт состояния подпроцесса возвращается кодом 3, а не переупаковывается', (t) => {
    const repo = makeRepo(t);
    // Запись PLAN в истории закрыта, а stage_status говорит running: cycle-state увидит
    // «закрывать нечего» и ответит конфликтом (код 3).
    const { dir } = writeCycle(repo, { stage: 'PLAN', stage_status: 'running' });
    const stateFile = join(dir, 'state.json');
    const state = readState(stateFile);
    state.history = state.history.map((/** @type {Record<string, any>} */ entry) => ({
      ...entry,
      finished_at: entry.finished_at ?? '2026-11-20T10:00:00.000Z',
      status: 'done',
    }));
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    writeFileSync(join(dir, 'plan.1.md'), '# план\n');

    const result = runCli(['run', '--dir', dir, '--root', repo]);
    assert.equal(result.code, 3, result.stderr);
    const report = parseRun(result.stdout);
    assert.equal(report.executed[0]?.code, 3);
    assert.match(/** @type {string} */ (report.executed[0]?.command), /cycle-state\.mjs finish/u);
  });
});
