/**
 * Тесты диспетчера `harness` (`npx @dnikulshin/harness init`).
 *
 * Проверяется то, чего не видно в тестах самих команд: маршрутизация имени в скрипт пакета,
 * передача аргументов без изменений и — главное — **код выхода запущенной команды**. Диспетчер,
 * который глотает код возврата, опаснее отсутствия диспетчера: `npx … init` «проходит» на упавшей
 * установке.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { COMMANDS, resolveCommand, usage } from './harness.mjs';

/** Путь к диспетчеру: тесты запускают его как отдельный процесс. */
const SCRIPT = fileURLToPath(new URL('./harness.mjs', import.meta.url));

/**
 * Запускает диспетчер.
 * @param {string[]} args
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runCli(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Временный каталог проекта.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-dispatch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('harness: диспетчер команд', () => {
  test('каждая команда — существующий скрипт пакета', () => {
    const scripts = fileURLToPath(new URL('.', import.meta.url));
    for (const [name, script] of Object.entries(COMMANDS)) {
      assert.ok(existsSync(join(scripts, script)), `${name} → ${script} существует`);
    }
  });

  test('resolveCommand отдаёт скрипт и остальные аргументы без изменений', () => {
    assert.deepEqual(resolveCommand(['init', '--root', 'проект', '--check']), {
      script: 'harness-init.mjs',
      rest: ['--root', 'проект', '--check'],
    });
    assert.deepEqual(resolveCommand([]), { script: null, rest: [] });
    assert.throws(() => resolveCommand(['deploy']), /неизвестная команда: deploy/u);
  });

  test('подсказка перечисляет команды диспетчера и настоящие bin', () => {
    const text = usage();
    assert.match(text, /harness <команда>/u);
    for (const name of Object.keys(COMMANDS)) assert.match(text, new RegExp(` ${name} `, 'u'));
    assert.match(text, /harness-cycle-state/u);
  });

  test('init ставит шаблоны в проект: код 0 и файлы на месте', (t) => {
    const root = tempDir(t);

    const result = runCli(['init', '--root', root]);

    assert.equal(result.code, 0, result.stderr);
    for (const path of ['.pi/harness.config.json', '.pi/agents/plan.md', '.pi/settings.json']) {
      assert.ok(existsSync(join(root, ...path.split('/'))), `${path} создан`);
    }
  });

  test('код выхода команды не глотается', (t) => {
    const root = tempDir(t);
    // Пустой проект без шаблонов: `check` падает с кодом 2 — диспетчер обязан его вернуть.
    const failed = runCli(['check', '--root', root]);
    assert.equal(failed.code, 2, 'код запущенной команды, а не 0');

    assert.equal(runCli(['init', '--root', root]).code, 0);
    // `AGENTS.md` — правила проекта: установщик его не пишет, а без него проверка не начинается.
    writeFileSync(join(root, 'AGENTS.md'), '# Проект\n\nРоли описаны в `.pi/agents/`.\n');
    const ok = runCli(['check', '--root', root]);
    assert.equal(ok.code, 0, `${ok.stdout}${ok.stderr}`);
  });

  test('дрейф раскладки возвращается как код 1, а не как успех', (t) => {
    const root = tempDir(t);
    assert.equal(runCli(['init', '--root', root]).code, 0);
    writeFileSync(join(root, 'AGENTS.md'), '# Проект\n\nМодель gpt-6-luna в прозе.\n');

    const drifted = runCli(['check', '--root', root]);
    assert.equal(drifted.code, 1, drifted.stdout);
    assert.match(drifted.stdout, /H6/u);
  });

  test('нет команды и неизвестная команда — код 2 с подсказкой', () => {
    const none = runCli([]);
    assert.equal(none.code, 2);
    assert.equal(none.stdout, '');
    assert.match(none.stderr, /использование: harness <команда>/u);

    const unknown = runCli(['deploy']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /неизвестная команда: deploy/u);
  });

  test('--help — код 0 и подсказка в stdout', () => {
    const result = runCli(['--help']);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /команды:/u);
  });
});
