import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  mergedBranchBlockReason,
  mergedPull,
  pushedBranches,
  staleMergedBranches,
} from './branch-guard.mjs';
import { describeGhFailure } from './gh-cli.mjs';

/** Корень репозитория: CLI проверок запускаются с ним в cwd. */
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PRE_PUSH = fileURLToPath(new URL('./pre-push.mjs', import.meta.url));
const HYGIENE = fileURLToPath(new URL('./git-hygiene.mjs', import.meta.url));

const BRANCH = 'chore/5-packaging';

/**
 * Временный каталог с подставным `gh`: тесты не ходят в сеть и не зависят от авторизации.
 * Реальный PATH сохраняется — `git`/`node` внутри скриптов должны находиться.
 * @param {string} stdout что печатает `gh` (ожидается JSON, как у `--json`)
 * @returns {string} значение PATH
 */
function fakeGhPath(stdout) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-gh-'));
  const script = join(dir, 'gh');
  writeFileSync(script, `#!/bin/sh\ncat <<'JSON'\n${stdout}\nJSON\n`);
  chmodSync(script, 0o755);
  return `${dir}:${process.env.PATH}`;
}

/**
 * Подставной `gh`, который падает: сценарий «GitHub недоступен или нет авторизации».
 * @returns {string} значение PATH
 */
function failingGhPath() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-gh-fail-'));
  const script = join(dir, 'gh');
  writeFileSync(script, '#!/bin/sh\necho "HTTP 401: Bad credentials" >&2\nexit 1\n');
  chmodSync(script, 0o755);
  return `${dir}:${process.env.PATH}`;
}

/**
 * Запуск хука/скрипта с подставным PATH.
 * @param {string} script
 * @param {{ path: string, input?: string }} options
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
function runWithPath(script, options) {
  return spawnSync(process.execPath, [script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input: options.input ?? '',
    env: { ...process.env, PATH: options.path },
  });
}

/**
 * Временный git-репозиторий с базовым коммитом.
 * @param {string} prefix префикс имени каталога
 * @returns {string} путь к репозиторию
 */
function makeRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  /** @param {string[]} args */
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

  git(['-c', 'init.defaultBranch=main', 'init']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'tracked.txt'), 'base\n');
  git(['add', 'tracked.txt']);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'base']);
  return dir;
}

describe('branch-guard: какие ветки реально пушатся', () => {
  test('ветки из refs/heads с коммитом, без дублей', () => {
    const branches = pushedBranches([
      { localRef: 'refs/heads/fix/1-a', localSha: 'abc123' },
      { localRef: 'refs/heads/fix/1-a', localSha: 'abc123' },
      { localRef: 'refs/heads/chore/2-b', localSha: 'def456' },
      { localRef: 'refs/tags/v1.0.0', localSha: 'aaa' },
    ]);

    assert.deepEqual(branches, ['fix/1-a', 'chore/2-b']);
  });

  test('удаление ветки (нулевой SHA) не считается push ветки', () => {
    const branches = pushedBranches([
      { localRef: 'refs/heads/fix/1-a', localSha: '0'.repeat(40) },
      { localRef: 'refs/heads/fix/1-b', localSha: '0'.repeat(64) },
    ]);

    assert.deepEqual(branches, []);
  });

  test('мусор вместо refs не ломает проверку', () => {
    assert.deepEqual(pushedBranches([]), []);
    assert.deepEqual(pushedBranches(/** @type {any} */ (null)), []);
    assert.deepEqual(pushedBranches(/** @type {any} */ ([{ localRef: null, localSha: null }])), []);
  });
});

describe('branch-guard: смерженный PR', () => {
  test('находится по ветке, открытый и закрытый PR-ы — нет', () => {
    const pulls = [
      { number: 100, state: 'OPEN', headRefName: BRANCH },
      { number: 101, state: 'CLOSED', headRefName: 'fix/2-c' },
    ];

    assert.equal(mergedPull(pulls, BRANCH), null);

    const merged = { number: 284, state: 'MERGED', headRefName: BRANCH };
    assert.deepEqual(mergedPull([...pulls, merged], BRANCH), merged);
    assert.equal(mergedPull(pulls, ''), null);
    assert.equal(mergedPull(/** @type {any} */ (null), BRANCH), null);
  });

  test('отказ называет ветку, PR, команду очистки и обход', () => {
    const reason = mergedBranchBlockReason(BRANCH, { number: 284 });

    assert.ok(reason !== null);
    assert.match(reason, /ветка «chore\/5-packaging» уже смержена \(PR #284\)/u);
    assert.match(reason, /git checkout main && git pull && git branch -D chore\/5-packaging/u);
    assert.match(reason, /pnpm git:hygiene/u);
    assert.match(reason, /--no-verify/u);
    assert.equal(mergedBranchBlockReason(BRANCH, /** @type {any} */ (null)), null);
  });

  test('локальные ветки со смерженными PR отбираются без дублей', () => {
    const rows = staleMergedBranches(
      ['main', 'chore/1-a', 'chore/2-b', 'chore/1-a', 'fix/3-c'],
      [
        { number: 10, state: 'MERGED', headRefName: 'chore/1-a', mergedAt: '2026-11-18T23:55:19Z' },
        { number: 11, state: 'CLOSED', headRefName: 'chore/2-b' },
        { number: 12, state: 'MERGED', headRefName: 'feat/9-z' },
      ],
    );

    assert.deepEqual(rows, [{ branch: 'chore/1-a', number: 10, mergedAt: '2026-11-18T23:55:19Z' }]);
    assert.deepEqual(staleMergedBranches([], /** @type {any} */ (null)), []);
  });
});

describe('gh-cli: сбои не считаются отказом', () => {
  test('причина сбоя — короткая строка', () => {
    assert.equal(
      describeGhFailure(Object.assign(new Error('нет'), { code: 'ENOENT' })),
      'gh не установлен',
    );
    assert.equal(
      describeGhFailure(
        Object.assign(new Error('boom'), { stderr: 'HTTP 401: Bad credentials\n' }),
      ),
      'HTTP 401: Bad credentials',
    );
    assert.equal(describeGhFailure(null), 'gh завершился с ошибкой');
  });
});

describe('pre-push: гейт смерженной ветки', () => {
  const mergedJson = JSON.stringify([
    { number: 284, state: 'MERGED', headRefName: BRANCH, url: 'https://example.invalid/284' },
  ]);
  const openedJson = JSON.stringify([{ number: 300, state: 'OPEN', headRefName: BRANCH }]);
  const line = `refs/heads/${BRANCH} abc123 refs/heads/${BRANCH} 000\n`;

  test('смерженный PR блокирует push с кодом 1', (t) => {
    const path = fakeGhPath(mergedJson);
    t.after(() => rmSync(path.split(':')[0] ?? '', { recursive: true, force: true }));

    const result = runWithPath(PRE_PUSH, { path, input: line });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /уже смержена \(PR #284\)/u);
  });

  test('открытый PR и отсутствие PR push не блокируют', (t) => {
    for (const json of [openedJson, '[]']) {
      const path = fakeGhPath(json);
      t.after(() => rmSync(path.split(':')[0] ?? '', { recursive: true, force: true }));

      const result = runWithPath(PRE_PUSH, { path, input: line });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
    }
  });

  test('GitHub недоступен — предупреждение и код 0', (t) => {
    const path = failingGhPath();
    t.after(() => rmSync(path.split(':')[0] ?? '', { recursive: true, force: true }));

    const result = runWithPath(PRE_PUSH, { path, input: line });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /состояние PR для «chore\/5-packaging» не проверено/u);
    assert.match(result.stderr, /HTTP 401/u);
  });

  test('защищённая ветка блокируется даже без gh', (t) => {
    const path = failingGhPath();
    t.after(() => rmSync(path.split(':')[0] ?? '', { recursive: true, force: true }));

    const result = runWithPath(PRE_PUSH, {
      path,
      input: 'refs/heads/main abc123 refs/heads/main 000\n',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /защищённую ветку «main»/u);
  });
});

describe('git-hygiene: отчёт по локальным веткам', () => {
  test('печатает смерженную ветку и команду удаления, exit 0', (t) => {
    const dir = makeRepo('harness-hygiene-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    /** @param {string[]} args */
    const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git(['checkout', '-b', BRANCH]);
    git(['checkout', 'main']);

    const ghPath = fakeGhPath(
      JSON.stringify([
        { number: 284, state: 'MERGED', headRefName: BRANCH, mergedAt: '2026-11-18T23:55:19Z' },
      ]),
    );
    t.after(() => rmSync(ghPath.split(':')[0] ?? '', { recursive: true, force: true }));

    const result = spawnSync(process.execPath, [HYGIENE], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: ghPath },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /chore\/5-packaging {2}PR #284, 2026-11-18/u);
    assert.match(result.stdout, /pnpm git:hygiene --prune/u);
  });

  test('сбой gh — причина и код 0', (t) => {
    const dir = makeRepo('harness-hygiene-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const ghPath = failingGhPath();
    t.after(() => rmSync(ghPath.split(':')[0] ?? '', { recursive: true, force: true }));

    const result = spawnSync(process.execPath, [HYGIENE], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: ghPath },
    });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /состояние PR не проверено \(HTTP 401/u);
  });
});
