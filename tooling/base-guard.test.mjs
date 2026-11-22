/**
 * Тесты гейта «база ветки» (`tooling/base-guard.mjs`) и его подключения в `pre-push`.
 *
 * Проверяется главное свойство: конфликт с `origin/main` отклоняет push **до** открытия PR, потому
 * что GitHub не запускает проверки у PR с конфликтами и такой PR приезжает молчаливым. Отставание
 * без конфликта — только предупреждение, а неизвестное состояние (нет `origin/main`, чужой sha) —
 * тишина: отказ по догадке хуже отсутствия подсказки.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BASE, baseProblem } from './base-guard.mjs';

const PRE_PUSH = fileURLToPath(new URL('./pre-push.mjs', import.meta.url));

/** Временные каталоги теста. @type {string[]} */
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('baseProblem: что печатать про базу', () => {
  test('конфликт с базой — отказ с командой rebase и объяснением про молчаливый CI', () => {
    const problem = baseProblem({ branch: 'docs/187-pages', behind: true, conflicts: true });

    assert.ok(problem !== null);
    assert.equal(problem.level, 'block');
    assert.match(problem.message, /«docs\/187-pages» конфликтует с origin\/main/u);
    assert.match(problem.message, /no checks reported/u);
    assert.match(problem.message, /git fetch origin && git rebase origin\/main/u);
    assert.match(problem.message, /rebase --continue/u);
  });

  test('отставание без конфликта — предупреждение, а не отказ', () => {
    const problem = baseProblem({ branch: 'feat/42-x', behind: true, conflicts: false });

    assert.ok(problem !== null);
    assert.equal(problem.level, 'warn');
    assert.match(problem.message, /отстаёт от origin\/main \(конфликта нет\)/u);
  });

  test('свежая ветка — молчание', () => {
    assert.equal(baseProblem({ branch: 'feat/42-x', behind: false, conflicts: true }), null);
  });

  test('неизвестное состояние — молчание: отказ по догадке хуже подсказки', () => {
    assert.equal(baseProblem({ branch: 'feat/42-x', behind: true, conflicts: null }), null);
    assert.equal(baseProblem({ branch: 'feat/42-x', behind: undefined, conflicts: true }), null);
    assert.equal(baseProblem({ branch: '', behind: true, conflicts: true }), null);
    assert.equal(baseProblem(), null);
  });

  test('имя базы подставляется в текст', () => {
    const problem = baseProblem({
      branch: 'feat/42-x',
      base: 'upstream/main',
      behind: true,
      conflicts: true,
    });

    assert.match(problem?.message ?? '', /upstream\/main/u);
  });

  test('без аргумента base используется default', () => {
    const problem = baseProblem({ branch: 'feat/42-x', behind: true, conflicts: true });

    assert.match(problem?.message ?? '', new RegExp(DEFAULT_BASE.replace('/', '\\/'), 'u'));
  });
});

/**
 * PATH с подставным `gh`, который не нашёл ни одного PR: тест не ходит в сеть.
 * @returns {string} PATH
 */
function noPullGhPath() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-gh-'));
  dirs.push(dir);
  const script = join(dir, 'gh');
  writeFileSync(script, "#!/bin/sh\necho '[]'\n");
  chmodSync(script, 0o755);

  return `${dir}:${process.env.PATH}`;
}

/**
 * Репозиторий с `origin/main` и веткой: база, изменение в `main`, ветка от базы.
 *
 * `origin/main` создаётся через `update-ref` — сеть не нужна, но хук видит ровно тот ref, который
 * ищет (`refs/remotes/origin/main`).
 * @param {{ branchChangesFile?: 'same' | 'other' | 'none' }} [options] что меняет ветка
 * @returns {{dir: string, branch: string, sha: string}} каталог, ветка и её коммит
 */
function repoWithBase({ branchChangesFile = 'same' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-base-'));
  dirs.push(dir);
  /** @param {string[]} args */
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

  git(['-c', 'init.defaultBranch=main', 'init']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'tracked.txt'), 'base\n');
  git(['add', 'tracked.txt']);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']).trim();

  writeFileSync(join(dir, 'tracked.txt'), 'main change\n');
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '-am', 'main change']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);

  git(['checkout', '-q', '-b', 'feat/42-x', base]);
  if (branchChangesFile === 'same') {
    writeFileSync(join(dir, 'tracked.txt'), 'branch change\n');
  } else if (branchChangesFile === 'other') {
    writeFileSync(join(dir, 'other.txt'), 'branch file\n');
  }
  // `none` — ветка без своих изменений: коммитить нечего, HEAD остаётся на базе.
  if (branchChangesFile !== 'none') {
    git(['add', '--all']);
    git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'branch']);
  }

  return { dir, branch: 'feat/42-x', sha: git(['rev-parse', 'HEAD']).trim() };
}

/**
 * Прогон `pre-push` с одним пушимым ref ветки.
 * @param {string} dir репозиторий
 * @param {string} branch ветка
 * @param {string} sha коммит
 * @returns {import('node:child_process').SpawnSyncReturns<string>} результат
 */
function runHook(dir, branch, sha) {
  return spawnSync(process.execPath, [PRE_PUSH], {
    cwd: dir,
    encoding: 'utf8',
    input: `refs/heads/${branch} ${sha} refs/heads/${branch} ${'0'.repeat(40)}\n`,
    env: { ...process.env, PATH: noPullGhPath() },
  });
}

describe('pre-push: база ветки в реальном репозитории', () => {
  test('ветка конфликтует с origin/main — отказ, а не молчаливый PR', () => {
    const { dir, branch, sha } = repoWithBase({ branchChangesFile: 'same' });
    const result = runHook(dir, branch, sha);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /конфликтует с origin\/main/u);
    assert.match(result.stderr, /rebase origin\/main/u);
  });

  test('ветка отстаёт, но конфликта нет — push проходит с предупреждением', () => {
    const { dir, branch, sha } = repoWithBase({ branchChangesFile: 'other' });
    const result = runHook(dir, branch, sha);

    assert.equal(result.status, 0);
    assert.match(result.stderr, /отстаёт от origin\/main \(конфликта нет\)/u);
  });

  test('ветка содержит базу — тишина', () => {
    const { dir, branch } = repoWithBase({ branchChangesFile: 'none' });
    execFileSync('git', ['merge', '--no-edit', 'origin/main'], { cwd: dir, stdio: 'pipe' });
    const merged = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
    const result = runHook(dir, branch, merged);

    assert.equal(result.status, 0);
    assert.ok(!result.stderr.includes('origin/main'), `неожиданное сообщение: ${result.stderr}`);
  });

  test('без `origin/main` (офлайн-клон) — молчание, push не блокируется', () => {
    const { dir, branch, sha } = repoWithBase({ branchChangesFile: 'same' });
    execFileSync('git', ['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: dir });
    const result = runHook(dir, branch, sha);

    assert.equal(result.status, 0);
    assert.ok(!result.stderr.includes('origin/main'), `неожиданное сообщение: ${result.stderr}`);
  });
});
