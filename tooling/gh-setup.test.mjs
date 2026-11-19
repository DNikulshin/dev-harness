/**
 * Тесты `tooling/gh-setup.mjs`: набор меток, режим merge и правила ветки `main`.
 *
 * Скрипт разговаривает с GitHub только через `gh`, поэтому тесты подставляют исполнителя
 * `run`: он записывает вызовы и ничего не делает. Главное, что проверяется без сети:
 * метки идемпотентны (`--force`), режим merge — только squash с удалением ветки,
 * защита запрашивается лишь по `--protect`, а `--dry-run` не выполняет ни одного вызова.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  LABELS,
  MERGE_SETTINGS,
  REQUIRED_CHECKS,
  SetupError,
  labelArgs,
  main,
  protectionPayload,
  resolveRepo,
  setup,
} from './gh-setup.mjs';

/**
 * Исполнитель `gh`, записывающий вызовы.
 * @returns {{ run: (args: string[], options?: { input?: string }) => string, calls: { args: string[], input?: string }[] }}
 */
function fakeGh() {
  /** @type {{ args: string[], input?: string }[]} */
  const calls = [];
  const run = (/** @type {string[]} */ args, /** @type {{input?: string}} */ options = {}) => {
    calls.push(options.input === undefined ? { args } : { args, input: options.input });
    return '{}';
  };
  return { run, calls };
}

describe('LABELS: набор меток процесса', () => {
  test('имена уникальны, цвета — шестизначный hex, описания не пустые', () => {
    const names = LABELS.map((label) => label.name);
    assert.equal(new Set(names).size, names.length, 'дубли имён');
    for (const label of LABELS) {
      assert.match(label.color, /^[0-9a-f]{6}$/u, `цвет ${label.name}`);
      assert.ok(label.description.length > 0, `описание ${label.name}`);
    }
  });

  test('статусы доски, типы, приоритеты и размеры на месте', () => {
    const names = new Set(LABELS.map((label) => label.name));
    for (const name of [
      'status:todo',
      'status:in-progress',
      'status:review',
      'status:blocked',
      'type:feature',
      'type:bug',
      'type:chore',
      'prio:p1',
      'size:m',
      'needs-owner',
    ]) {
      assert.ok(names.has(name), `нет метки ${name}`);
    }
  });
});

describe('protectionPayload: правила ветки main', () => {
  test('PR обязателен всем, проверки строгие, force-push и удаление запрещены', () => {
    const payload = protectionPayload();

    assert.deepEqual(payload.required_status_checks, {
      strict: true,
      contexts: [...REQUIRED_CHECKS],
    });
    assert.equal(payload.enforce_admins, true);
    assert.equal(payload.required_pull_request_reviews.required_approving_review_count, 0);
    assert.equal(payload.required_pull_request_reviews.dismiss_stale_reviews, true);
    assert.equal(payload.allow_force_pushes, false);
    assert.equal(payload.allow_deletions, false);
    assert.equal(payload.restrictions, null);
  });

  test('обязательные проверки переопределяемы', () => {
    assert.deepEqual(protectionPayload(['checks', 'lint']).required_status_checks.contexts, [
      'checks',
      'lint',
    ]);
  });
});

describe('labelArgs', () => {
  test('создание идемпотентно: --force и явный репозиторий', () => {
    const args = labelArgs(
      { name: 'type:chore', color: '6e7781', description: 'Инфра' },
      'acme/repo',
    );
    assert.deepEqual(args, [
      'label',
      'create',
      'type:chore',
      '--repo',
      'acme/repo',
      '--color',
      '6e7781',
      '--description',
      'Инфра',
      '--force',
    ]);
  });
});

describe('setup: последовательность вызовов', () => {
  test('без --protect: метки и режим merge, правил ветки нет', () => {
    const { run, calls } = fakeGh();
    const result = setup({ run, repo: 'acme/repo' });

    assert.deepEqual(result, { labels: LABELS.length, merge: true, protected: false });
    const creates = calls.filter((call) => call.args[1] === 'create');
    assert.equal(creates.length, LABELS.length);

    const patch = calls.find((call) => call.args.includes('PATCH'));
    assert.ok(patch, 'настройки репозитория отправлены');
    assert.deepEqual(JSON.parse(String(patch.input)), MERGE_SETTINGS);
    assert.equal(
      calls.some((call) => call.args.includes('PUT')),
      false,
      'защита не запрашивалась',
    );
  });

  test('с --protect: добавляется PUT правил ветки main', () => {
    const { run, calls } = fakeGh();
    const result = setup({ run, repo: 'acme/repo', protect: true });

    assert.equal(result.protected, true);
    const put = calls.find((call) => call.args.includes('PUT'));
    assert.ok(put, 'правила ветки отправлены');
    assert.ok(put.args.includes('repos/acme/repo/branches/main/protection'));
    assert.deepEqual(JSON.parse(String(put.input)), protectionPayload());
  });

  test('--dry-run: ни одного вызова gh, только план', () => {
    const { run, calls } = fakeGh();
    /** @type {string[]} */
    const lines = [];
    const result = setup({
      run,
      repo: 'acme/repo',
      protect: true,
      dryRun: true,
      log: (line) => lines.push(line),
    });

    assert.deepEqual(calls, [], 'в dry-run запись запрещена');
    assert.equal(result.labels, LABELS.length);
    assert.ok(lines.some((line) => line.startsWith('(dry-run) gh label create')));
    assert.ok(lines.some((line) => line.includes('branches/main/protection')));
  });
});

describe('main: CLI', () => {
  /**
   * Прогон CLI с перехватом stderr.
   * @param {string[]} argv
   * @param {{ repo?: string }} [options]
   * @returns {{ code: number, lines: string[], stderr: string, calls: { args: string[] }[] }}
   */
  function runMain(argv, options = {}) {
    const { run, calls } = fakeGh();
    /** @type {string[]} */
    const lines = [];
    let stderr = '';
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (/** @type {any} */ chunk) => {
      stderr += String(chunk);
      return true;
    };
    try {
      const code = main({
        argv,
        env: { REPO: options.repo ?? 'acme/repo' },
        run,
        log: (line) => lines.push(line),
      });
      return { code, lines, stderr, calls };
    } finally {
      process.stderr.write = original;
    }
  }

  test('неизвестный аргумент — код 2 и подсказка', () => {
    const { code, stderr, calls } = runMain(['--force']);
    assert.equal(code, 2);
    assert.match(stderr, /неизвестный аргумент: --force/u);
    assert.deepEqual(calls, []);
  });

  test('REPO не задан — берётся из gh repo view', () => {
    const { run, calls } = fakeGh();
    const original = run;
    const withRepo = (/** @type {string[]} */ args, /** @type {any} */ options = {}) =>
      args[0] === 'repo'
        ? JSON.stringify({ nameWithOwner: 'acme/from-gh' })
        : original(args, options);

    assert.equal(resolveRepo(withRepo), 'acme/from-gh');
    assert.deepEqual(calls, []);
  });

  test('успешный прогон печатает сводку и код 0', () => {
    const { code, lines } = runMain(['--protect']);
    assert.equal(code, 0);
    assert.match(lines.at(-1) ?? '', /защита main ok/u);
  });
});

test('скрипт исполняемый: shebang на месте (запускается напрямую)', () => {
  const source = readFileSync(new URL('./gh-setup.mjs', import.meta.url), 'utf8');
  assert.match(source, /^#!\/usr\/bin\/env node\n/u);
});

test('SetupError отличает ошибку настройки от прочих', () => {
  assert.ok(new SetupError('x') instanceof Error);
});
