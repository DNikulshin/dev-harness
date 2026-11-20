/**
 * Внешний потребитель пакета (issue #66): установка **как зависимости**, а не работа с исходным
 * репозиторием.
 *
 * Зачем отдельный тест. `harness-init.test.mjs` проверяет установку шаблонов в `tmpdir`, но берёт
 * их из репозитория: ошибка в `files`, `exports`, `bin` или `types/` выяснялась бы у потребителя.
 * Здесь пакет пакуется (`pnpm pack`), ставится в чистый проект (`pnpm install` из архива, без сети
 * и без `devDependencies` ядра) и проверяется тем, чем потребитель и пользуется: ESM-импортом по
 * `exports`, `bin`-шимами, `check-harness` и циклом, `tsc` по `.d.ts` из архива.
 *
 * Архив собирается один раз на весь блок: три секунды на тест вместо секунды на каждый. Ни одна
 * проверка не читает файлы ядра по абсолютному пути, кроме самого архива и компилятора: если для
 * работы потребителю нужен исходный репозиторий, тест обязан краснеть.
 *
 * Тесты и фикстуры в архиве — не мусор, а данные `harness-selftest` (`scripts/selftest.mjs`): он
 * прогоняет тесты установленного пакета из `node_modules`. Поэтому наличие `scripts/fixtures/**`
 * проверяется как контракт, а не как утечка.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

/** Корень репозитория ядра: родитель каталога `scripts/`. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Компилятор для проверки типов: инструмент ядра, не зависимость потребителя. */
const TSC = join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');

/** Что обязано быть в архиве, чтобы потребитель заработал (контракт `files`). */
const REQUIRED_ENTRIES = Object.freeze([
  'LICENSE',
  'README.md',
  'package.json',
  'scripts/cycle-state.mjs',
  'scripts/check-harness.mjs',
  'scripts/selftest.mjs',
  'scripts/fixtures/cycle/project/.pi/harness.config.json',
  'types/cycle-state.d.mts',
  'templates/.pi/agents/plan.md',
  'docs/adr/README.md',
]);

/** Чего в архиве быть не должно: локальные артефакты и инфраструктура репозитория. */
const FORBIDDEN_ENTRIES = Object.freeze([
  '.pi/artifacts/',
  'node_modules/',
  'evals/',
  'tooling/',
  '.github/',
  '.githooks/',
]);

/**
 * Запуск команды с захватом вывода: тесты не должны сыпать логами `pnpm` в отчёт `node --test`.
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * `bin`-шим установленного пакета.
 * @param {string} name
 * @returns {string}
 */
function bin(name) {
  return join(state.proj, 'node_modules', '.bin', name);
}

/** @type {{ root: string, pack: string, proj: string }} общий стенд блока */
const state = { root: '', pack: '', proj: '' };

describe('package: внешний потребитель', () => {
  before(() => {
    state.root = mkdtempSync(join(tmpdir(), 'harness-consumer-'));
    state.pack = packTo(state.root);

    state.proj = join(state.root, 'consumer');
    mkdirSync(state.proj);
    writeFileSync(
      join(state.proj, 'package.json'),
      `${JSON.stringify(
        {
          name: 'consumer-fixture',
          private: true,
          type: 'module',
          dependencies: { '@dnikulshin/harness': `file:../${basename(state.pack)}` },
        },
        null,
        2,
      )}\n`,
    );

    const install = run('pnpm', ['install', '--offline', '--ignore-scripts', '--prefer-offline'], {
      cwd: state.proj,
    });
    assert.equal(install.status, 0, `pnpm install из архива: ${install.stderr}`);
  });

  after(() => {
    rmSync(state.root, { recursive: true, force: true });
  });

  test('архив содержит контракт пакета и не тащит инфраструктуру репозитория', () => {
    const entries = archiveEntries(state.pack);

    for (const path of REQUIRED_ENTRIES) {
      assert.ok(entries.has(path), `в архиве нет ${path} — сломан files или шаблоны не поехали`);
    }
    for (const prefix of FORBIDDEN_ENTRIES) {
      const leaked = [...entries].filter((entry) => entry.startsWith(prefix));
      assert.deepEqual(leaked, [], `в архив попало лишнее: ${prefix}`);
    }
    assert.ok(entries.has('types/cycle-state.d.mts'), 'типы потребителя едут в архиве');
  });

  test('bin-шимы установлены и запускаются из node_modules', () => {
    const names = readdirSync(join(state.proj, 'node_modules', '.bin')).sort();
    for (const expected of ['harness-cycle-state', 'harness-check-layout', 'harness-init']) {
      assert.ok(names.includes(expected), `нет bin ${expected}: ${names.join(', ')}`);
    }

    const usage = run(bin('harness-cycle-state'), [], { cwd: state.proj });
    assert.equal(usage.status, 2, 'без подкоманды — код 2, как в контракте CLI');
    assert.match(usage.stdout + usage.stderr, /init \| get \| advance/, 'подсказка по подкомандам');
  });

  test('импорт идёт по exports, шаблоны и типы доступны, закрытое — закрыто', () => {
    const probe = join(state.proj, 'probe.mjs');
    writeFileSync(
      probe,
      [
        "import { canTransition } from '@dnikulshin/harness/scripts/cycle-state';",
        "const templates = import.meta.resolve('@dnikulshin/harness/templates/.pi/agents/plan.md');",
        'console.log(JSON.stringify({ allowed: canTransition("INIT", "PLAN"), templates }));',
        '',
      ].join('\n'),
    );

    const result = run(process.execPath, [probe], { cwd: state.proj });
    assert.equal(result.status, 0, `ESM-импорт по exports: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.allowed, true);
    assert.match(parsed.templates, /node_modules.+templates\/\.pi\/agents\/plan\.md$/u);

    // Обратная сторона контракта: путь вне `exports` не резолвится. Если это перестанет быть
    // правдой, карта `exports` перестала ограничивать потребителя.
    const closed = join(state.proj, 'closed.mjs');
    writeFileSync(closed, "await import('@dnikulshin/harness/docs/protocol.md');\n");
    const denied = run(process.execPath, [closed], { cwd: state.proj });
    assert.notEqual(denied.status, 0, 'неэкспортированный путь не должен резолвиться');
    assert.match(denied.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/u);
  });

  test('init, проверка раскладки и цикл работают из установленного пакета', () => {
    const app = join(state.proj, 'app');
    mkdirSync(app);
    /** @param {string[]} args */
    const git = (args) =>
      run('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], {
        cwd: app,
      });
    assert.equal(git(['-c', 'init.defaultBranch=main', 'init']).status, 0);
    assert.equal(git(['commit', '--allow-empty', '-m', 'base']).status, 0);
    writeFileSync(join(app, 'AGENTS.md'), '# Проект\n\nПравила проекта.\n');

    const init = run(bin('harness-init'), ['--root', app], { cwd: state.proj });
    assert.equal(init.status, 0, `harness-init: ${init.stderr}`);
    for (const file of ['.pi/harness.config.json', '.pi/agents/plan.md', '.pi/settings.json']) {
      assert.ok(existsSync(join(app, file)), `harness-init не создал ${file}`);
    }

    const layout = run(bin('harness-check-layout'), [], { cwd: app });
    assert.equal(layout.status, 0, `check-harness на свежей установке: ${layout.stdout}`);

    const started = run(
      bin('harness-cycle-state'),
      ['init', '--issue', '1', '--slug', 'probe', '--date', '2026-11-20', '--branch', 'main'],
      { cwd: app },
    );
    assert.equal(started.status, 0, `cycle-state init: ${started.stderr}`);

    const driver = run(bin('harness-cycle-driver'), ['next'], { cwd: app });
    assert.equal(driver.status, 0, `cycle-driver next: ${driver.stderr}`);
    const step = JSON.parse(driver.stdout);
    assert.equal(step.stage, 'INIT');
    assert.equal(step.step, 'criteria');
    assert.equal(step.action, 'run');

    // Контракт адаптера: команды указывают на установленный пакет, а не на исходный репозиторий.
    assert.ok(step.commands.length > 0, 'шаг предлагает команды');
    for (const command of step.commands) {
      assert.ok(command.includes('node_modules'), `команда идёт из пакета: ${command}`);
      assert.ok(
        !command.includes(ROOT),
        `команда не должна ссылаться на исходный репозиторий: ${command}`,
      );
    }
  });

  test('типы приходят из пакета: .d.ts из архива, а не any', () => {
    writeFileSync(
      join(state.proj, 'probe.ts'),
      [
        "import { canTransition } from '@dnikulshin/harness/scripts/cycle-state';",
        '',
        "const allowed: boolean = canTransition('INIT', 'PLAN');",
        '// @ts-expect-error результат — boolean, а не number: с типами-`any` директива стала бы лишней',
        "const wrong: number = canTransition('INIT', 'PLAN');",
        '',
        'export { allowed, wrong };',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(state.proj, 'tsconfig.probe.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: 'es2023',
            module: 'nodenext',
            moduleResolution: 'nodenext',
            types: [],
            skipLibCheck: true,
          },
          include: ['probe.ts'],
        },
        null,
        2,
      )}\n`,
    );

    const result = run(process.execPath, [TSC, '-p', join(state.proj, 'tsconfig.probe.json')], {
      cwd: state.proj,
    });
    assert.equal(result.status, 0, `tsc по типам из пакета: ${result.stdout}${result.stderr}`);
  });
});

/**
 * Собирает архив пакета в каталог и возвращает путь к нему.
 * @param {string} dir
 * @returns {string}
 */
function packTo(dir) {
  const pack = run('pnpm', ['pack', '--pack-destination', dir], { cwd: ROOT });
  assert.equal(pack.status, 0, `pnpm pack: ${pack.stderr}`);
  const archives = readdirSync(dir).filter((name) => name.endsWith('.tgz'));
  assert.equal(
    archives.length,
    1,
    `pnpm pack должен дать один архив, получено: ${archives.join(', ')}`,
  );
  const archive = archives[0];
  assert.ok(archive !== undefined, 'архив найден');
  return join(dir, archive);
}

/**
 * Имена файлов внутри архива без ведущего `package/` — так их видит установленный пакет.
 * @param {string} file
 * @returns {Set<string>}
 */
function archiveEntries(file) {
  const listing = execFileSync('tar', ['-tzf', file], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return new Set(
    listing
      .split('\n')
      .filter((line) => line !== '' && !line.endsWith('/'))
      .map((line) => line.replace(/^package\//u, '')),
  );
}
