import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { DEFAULTS, loadConfig } from './lib/cycle/config.mjs';
import {
  buildVersionDoc,
  collectTemplates,
  defaultLayout,
  digest,
  installLayout,
  minimalSettings,
  parseArgs,
  planInstall,
  readSettingsState,
  readVersionFile,
  runInit,
  targetFor,
} from './harness-init.mjs';

/** Путь к CLI: тесты запускают его как отдельный процесс. */
const SCRIPT = fileURLToPath(new URL('./harness-init.mjs', import.meta.url));

/** Проверка раскладки: установка и `check-harness` обязаны видеть одно дерево (#81). */
const CHECK_SCRIPT = fileURLToPath(new URL('./check-harness.mjs', import.meta.url));

/** Настоящие шаблоны пакета: установка по умолчанию берёт их. */
const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

/**
 * Временный каталог, удаляемый после теста.
 * @param {import('node:test').TestContext} t
 * @param {string} [prefix]
 * @returns {string}
 */
function tempDir(t, prefix = 'harness-init-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Копия настоящих шаблонов: тесты, которые «обновляют пакет», правят копию.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function templatesCopy(t) {
  const dir = join(tempDir(t), 'templates');
  cpSync(TEMPLATES, dir, { recursive: true });
  return dir;
}

/**
 * Запускает CLI.
 * @param {string[]} args
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runCli(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Запускает произвольный скрипт ядра.
 * @param {string} script
 * @param {string[]} args
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runScript(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Строки stdout без завершающего перевода.
 * @param {string} stdout
 * @returns {string[]}
 */
function lines(stdout) {
  return stdout === '' ? [] : stdout.replace(/\n$/u, '').split('\n');
}

/**
 * Создаёт дерево шаблонов из карты «путь → текст».
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} files пути относительно `templates/`
 * @returns {string} каталог шаблонов
 */
function makeTemplates(t, files) {
  const root = join(tempDir(t), 'templates');
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, ...path.split('/'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

/**
 * Создаёт проект из карты «путь → текст».
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} files пути относительно корня проекта
 * @returns {string} корень проекта
 */
function makeProject(t, files = {}) {
  const root = join(tempDir(t), 'project');
  mkdirSync(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, ...path.split('/'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

/**
 * Читает файл проекта.
 * @param {string} root
 * @param {string} path
 * @returns {string}
 */
function read(root, path) {
  return readFileSync(join(root, ...path.split('/')), 'utf8');
}

describe('parseArgs', () => {
  test('по умолчанию — текущий каталог, шаблоны пакета, без режимов', () => {
    const args = parseArgs([]);

    assert.equal(args.root, process.cwd());
    assert.equal(args.templates, fileURLToPath(new URL('../templates', import.meta.url)));
    assert.equal(args.dryRun, false);
    assert.equal(args.check, false);
    assert.equal(args.force, false);
  });

  test('--root и --templates разворачиваются в абсолютные пути', () => {
    const args = parseArgs(['--root', 'sub/dir', '--templates', 'tpl']);

    assert.equal(args.root, join(process.cwd(), 'sub', 'dir'));
    assert.equal(args.templates, join(process.cwd(), 'tpl'));
  });

  test('режимы включаются флагами', () => {
    const args = parseArgs(['--dry-run', '--check', '--force']);

    assert.deepEqual([args.dryRun, args.check, args.force], [true, true, true]);
  });

  test('флаг без значения и неизвестный аргумент — ошибка', () => {
    assert.throws(() => parseArgs(['--root']), /--root: ожидается путь/);
    assert.throws(() => parseArgs(['--root', '--check']), /--root: ожидается путь/);
    assert.throws(() => parseArgs(['--yes']), /неизвестный аргумент: --yes/);
  });
});

describe('collectTemplates', () => {
  test('конфиг устанавливается под рабочим именем, остальное — как есть', (t) => {
    const root = makeTemplates(t, {
      '.pi/agents/plan.md': 'plan\n',
      '.pi/prompts/cycle.md': 'cycle\n',
      '.pi/harness.config.example.json': '{}\n',
    });

    const templates = collectTemplates(root);

    assert.deepEqual(
      templates.map((item) => [item.source, item.target]),
      [
        ['.pi/agents/plan.md', '.pi/agents/plan.md'],
        ['.pi/harness.config.example.json', '.pi/harness.config.json'],
        ['.pi/prompts/cycle.md', '.pi/prompts/cycle.md'],
      ],
    );
    assert.equal(templates[0]?.digest, digest('plan\n'));
  });

  test('нет каталога `.pi` в шаблонах — ошибка', (t) => {
    const root = makeTemplates(t, { 'agents/plan.md': 'plan\n' });

    assert.throws(() => collectTemplates(root), /шаблоны не найдены/);
    assert.throws(() => collectTemplates(join(root, 'nope')), /шаблоны не найдены/);
  });
});

describe('readVersionFile', () => {
  test('нет файла — пустая запись', (t) => {
    const root = tempDir(t);

    assert.deepEqual(readVersionFile(join(root, 'harness.version')), {
      version: null,
      templates: {},
    });
  });

  test('читает версию и дайджесты', (t) => {
    const root = tempDir(t);
    const file = join(root, 'harness.version');
    writeFileSync(file, JSON.stringify({ version: '1.2.3', templates: { 'a.md': 'abc' } }));

    assert.deepEqual(readVersionFile(file), { version: '1.2.3', templates: { 'a.md': 'abc' } });
  });

  test('битый JSON, не объект и неверный шаблон — ошибки', (t) => {
    const root = tempDir(t);
    const file = join(root, 'harness.version');

    writeFileSync(file, '{ oops');
    assert.throws(() => readVersionFile(file), /не читается как JSON/);

    writeFileSync(file, '[]');
    assert.throws(() => readVersionFile(file), /ожидается объект/);

    writeFileSync(file, JSON.stringify({ version: '1', templates: [] }));
    assert.throws(() => readVersionFile(file), /templates должно быть объектом/);

    writeFileSync(file, JSON.stringify({ version: '1', templates: { 'a.md': 7 } }));
    assert.throws(() => readVersionFile(file), /templates\["a.md"\] должен быть строкой/);
  });
});

describe('planInstall', () => {
  test('нет файла — create; совпадает — current', (t) => {
    const root = makeProject(t, { '.pi/agents/plan.md': 'план\n' });
    const templates = [
      {
        source: '.pi/agents/plan.md',
        target: '.pi/agents/plan.md',
        text: 'план\n',
        digest: digest('план\n'),
      },
      {
        source: '.pi/agents/code.md',
        target: '.pi/agents/code.md',
        text: 'код\n',
        digest: digest('код\n'),
      },
    ];

    const plan = planInstall({ root, templates, recorded: {} });

    assert.deepEqual(
      plan.entries.map((entry) => [entry.target, entry.state]),
      [
        ['.pi/agents/plan.md', 'current'],
        ['.pi/agents/code.md', 'create'],
      ],
    );
    assert.deepEqual(plan.removed, []);
  });

  test('правили локально — modified; старая версия без правок — update', (t) => {
    const root = makeProject(t, {
      '.pi/agents/plan.md': 'правка\n',
      '.pi/agents/code.md': 'старый шаблон\n',
    });
    const templates = [
      {
        source: '.pi/agents/plan.md',
        target: '.pi/agents/plan.md',
        text: 'новый\n',
        digest: digest('новый\n'),
      },
      {
        source: '.pi/agents/code.md',
        target: '.pi/agents/code.md',
        text: 'новый код\n',
        digest: digest('новый код\n'),
      },
    ];

    const plan = planInstall({
      root,
      templates,
      recorded: { '.pi/agents/code.md': digest('старый шаблон\n') },
    });

    assert.deepEqual(
      plan.entries.map((entry) => entry.state),
      ['modified', 'update'],
    );
  });

  test('конфиг проекта, который уже есть, не обновляется даже при расхождении', (t) => {
    const root = makeProject(t, { '.pi/harness.config.json': '{ "gates": [] }\n' });
    const templates = [
      {
        source: '.pi/harness.config.example.json',
        target: '.pi/harness.config.json',
        text: '{}\n',
        digest: digest('{}\n'),
      },
    ];

    const plan = planInstall({ root, templates, recorded: {} });

    assert.equal(plan.entries[0]?.state, 'owned');
  });

  test('файл из записи, которого больше нет в шаблонах, попадает в removed', () => {
    const plan = planInstall({
      root: '/nowhere',
      templates: [],
      recorded: { '.pi/agents/старый.md': 'abc' },
    });

    assert.deepEqual(plan.removed, ['.pi/agents/старый.md']);
    assert.deepEqual(plan.entries, []);
  });
});

describe('readSettingsState', () => {
  test('нет файла — absent', (t) => {
    assert.equal(readSettingsState(join(tempDir(t), 'settings.json')).state, 'absent');
  });

  test('лимит ≥ 7 — current, меньше — low, не число — invalid', (t) => {
    const root = tempDir(t);
    const file = join(root, 'settings.json');

    writeFileSync(file, JSON.stringify({ subagents: { maxSubagentSpawnsPerRun: 12 } }));
    assert.deepEqual(readSettingsState(file), { state: 'current', value: 12 });

    writeFileSync(file, JSON.stringify({ subagents: { maxSubagentSpawnsPerRun: 5 } }));
    assert.deepEqual(readSettingsState(file), { state: 'low', value: 5 });

    writeFileSync(file, JSON.stringify({ subagents: { maxSubagentSpawnsPerRun: '7' } }));
    assert.deepEqual(readSettingsState(file), { state: 'invalid', value: null });
  });

  test('нет поля subagents или битый файл — не трогаем, но H5 не выполнен', (t) => {
    const root = tempDir(t);
    const file = join(root, 'settings.json');

    writeFileSync(file, JSON.stringify({ defaultModel: 'acme/x' }));
    assert.deepEqual(readSettingsState(file), { state: 'low', value: null });

    writeFileSync(file, '{ oops');
    assert.deepEqual(readSettingsState(file), { state: 'unreadable', value: null });
  });
});

describe('buildVersionDoc', () => {
  test('пишет дайджесты шаблонов в стабильном порядке ключей', () => {
    const doc = buildVersionDoc({
      version: '0.1.0',
      templates: [
        { target: '.pi/b.md', state: 'current', digest: 'bbb' },
        { target: '.pi/a.md', state: 'create', digest: 'aaa' },
      ],
      recorded: {},
      force: false,
    });

    assert.deepEqual(doc, {
      version: '0.1.0',
      templates: { '.pi/a.md': 'aaa', '.pi/b.md': 'bbb' },
    });
    assert.deepEqual(Object.keys(/** @type {any} */ (doc).templates), ['.pi/a.md', '.pi/b.md']);
  });

  test('пропущенная правка сохраняет прежний дайджест, иначе обновление затрёт её', () => {
    const doc = buildVersionDoc({
      version: '0.1.0',
      templates: [{ target: '.pi/agents/plan.md', state: 'modified', digest: 'packaged' }],
      recorded: { '.pi/agents/plan.md': 'installed' },
      force: false,
    });

    assert.deepEqual(/** @type {any} */ (doc).templates, {
      '.pi/agents/plan.md': 'installed',
    });
  });

  test('файл без записи не попадает в версию: провенанс неизвестен', () => {
    const doc = buildVersionDoc({
      version: '0.1.0',
      templates: [{ target: '.pi/agents/plan.md', state: 'modified', digest: 'packaged' }],
      recorded: {},
      force: false,
    });

    assert.deepEqual(/** @type {any} */ (doc).templates, {});
  });

  test('--force фиксирует дайджест пакета: файл стал нашим', () => {
    const doc = buildVersionDoc({
      version: '0.1.0',
      templates: [{ target: '.pi/agents/plan.md', state: 'modified', digest: 'packaged' }],
      recorded: { '.pi/agents/plan.md': 'installed' },
      force: true,
    });

    assert.deepEqual(/** @type {any} */ (doc).templates, { '.pi/agents/plan.md': 'packaged' });
  });
});

describe('runInit: режимы не пишут лишнего', () => {
  test('--check и --dry-run не вызывают запись', (t) => {
    const root = makeProject(t);
    const templates = templatesCopy(t);
    /** @type {string[]} */
    const written = [];

    for (const flag of ['--check', '--dry-run']) {
      runInit(parseArgs(['--root', root, '--templates', templates, flag]), {
        write: (file) => written.push(file),
        log: () => {},
      });
    }

    assert.deepEqual(written, [], 'ни --check, ни --dry-run не пишут файлов');
  });

  test('установка с внедрённой записью сообщает шаги и не трогает диск', (t) => {
    const root = makeProject(t);
    const templates = templatesCopy(t);
    /** @type {{ file: string, text: string }[]} */
    const written = [];
    /** @type {string[]} */
    const log = [];

    const result = runInit(parseArgs(['--root', root, '--templates', templates]), {
      write: (file, text) => {
        written.push({ file, text });
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, text);
      },
      log: (line) => log.push(line),
    });

    assert.equal(result.code, 0);
    assert.ok(written.length >= 6, 'агенты, промпт, конфиг, настройки, версия');
    assert.ok(log.some((line) => line.includes('создан: .pi/agents/plan.md')));
    assert.ok(log.some((line) => line.includes(`.pi/settings.json`)));
  });
});

describe('CLI на временном проекте', () => {
  test('пустой проект: шаблоны, настройки и версия установлены', (t) => {
    const root = makeProject(t);

    const result = runCli(['--root', root]);

    assert.equal(result.code, 0, result.stderr);
    for (const path of [
      '.pi/agents/plan.md',
      '.pi/agents/code.md',
      '.pi/agents/review.md',
      '.pi/agents/evaluate.md',
      '.pi/prompts/cycle.md',
      '.pi/harness.config.json',
      '.pi/settings.json',
      '.pi/harness.version',
    ]) {
      assert.ok(existsSync(join(root, ...path.split('/'))), `${path} создан`);
    }
    assert.deepEqual(JSON.parse(read(root, '.pi/settings.json')), minimalSettings());
    assert.equal(
      read(root, '.pi/agents/plan.md'),
      readFileSync(join(TEMPLATES, '.pi/agents/plan.md'), 'utf8'),
    );
    const version = JSON.parse(read(root, '.pi/harness.version'));
    assert.match(version.version, /^\d+\.\d+\.\d+$/u);
    assert.deepEqual(Object.keys(version.templates), [
      '.pi/agents/code.md',
      '.pi/agents/evaluate.md',
      '.pi/agents/plan.md',
      '.pi/agents/review.md',
      '.pi/harness.config.json',
      '.pi/prompts/cycle.md',
    ]);
    assert.ok(result.stdout.includes('нет AGENTS.md'), 'подсказка про AGENTS.md');
  });

  test('повторный запуск идемпотентен: ни файла, ни байта не меняет', (t) => {
    const root = makeProject(t);
    assert.equal(runCli(['--root', root]).code, 0);

    const before = {
      plan: read(root, '.pi/agents/plan.md'),
      version: read(root, '.pi/harness.version'),
    };
    const second = runCli(['--root', root]);

    assert.equal(second.code, 0, second.stderr);
    assert.equal(read(root, '.pi/agents/plan.md'), before.plan);
    assert.equal(read(root, '.pi/harness.version'), before.version);
    assert.ok(!second.stdout.includes('записан: .pi/harness.version'), 'версия не перезаписана');
  });

  test('правка шаблона руками не затирается: код 1 и подсказка про --force', (t) => {
    const root = makeProject(t);
    assert.equal(runCli(['--root', root]).code, 0);
    writeFileSync(join(root, '.pi/agents/plan.md'), 'моя версия роли\n');

    const result = runCli(['--root', root]);

    assert.equal(result.code, 1);
    assert.match(
      result.stdout,
      /\.pi\/agents\/plan\.md: пропущен — правили локально, нужен --force/,
    );
    assert.equal(read(root, '.pi/agents/plan.md'), 'моя версия роли\n');
  });

  test('--force перезаписывает правку и фиксирует шаблон', (t) => {
    const root = makeProject(t);
    assert.equal(runCli(['--root', root]).code, 0);
    writeFileSync(join(root, '.pi/agents/plan.md'), 'моя версия роли\n');

    const result = runCli(['--root', root, '--force']);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('перезаписан (--force): .pi/agents/plan.md'));
    assert.equal(
      read(root, '.pi/agents/plan.md'),
      readFileSync(join(TEMPLATES, '.pi/agents/plan.md'), 'utf8'),
    );
    assert.equal(runCli(['--root', root]).code, 0, 'следующий запуск без расхождений');
  });

  test('новая версия шаблона обновляется, конфиг проекта — нет', (t) => {
    const templates = templatesCopy(t);
    const root = makeProject(t);
    assert.equal(runCli(['--root', root, '--templates', templates]).code, 0);
    writeFileSync(join(root, '.pi/harness.config.json'), `{ "gates": [] }\n`);
    const planTemplate = join(templates, '.pi/agents/plan.md');
    writeFileSync(planTemplate, `${readFileSync(planTemplate, 'utf8')}Обновлённая роль.\n`);

    const result = runCli(['--root', root, '--templates', templates]);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('обновлён: .pi/agents/plan.md'));
    assert.ok(result.stdout.includes('.pi/harness.config.json: конфиг проекта, не меняется'));
    assert.equal(read(root, '.pi/harness.config.json'), `{ "gates": [] }\n`);
    assert.match(read(root, '.pi/agents/plan.md'), /Обновлённая роль\./u);
  });

  test('--check: актуальное дерево — 0, дрейф — 1 и список причин', (t) => {
    const templates = templatesCopy(t);
    const root = makeProject(t);
    assert.equal(runCli(['--root', root, '--templates', templates]).code, 0);

    const fresh = runCli(['--root', root, '--templates', templates, '--check']);
    assert.equal(fresh.code, 0);
    assert.deepEqual(lines(fresh.stdout), ['шаблоны актуальны']);

    writeFileSync(join(root, '.pi/agents/plan.md'), 'правка\n');
    const planTemplate = join(templates, '.pi/agents/code.md');
    writeFileSync(planTemplate, `${readFileSync(planTemplate, 'utf8')}Новая роль.\n`);

    const drifted = runCli(['--root', root, '--templates', templates, '--check']);
    assert.equal(drifted.code, 1);
    assert.deepEqual(lines(drifted.stdout).sort(), [
      '.pi/agents/code.md: устарел относительно пакета',
      '.pi/agents/plan.md: правили локально, шаблон другой',
    ]);
  });

  test('--check не считает конфиг проекта дрейфом', (t) => {
    const root = makeProject(t);
    assert.equal(runCli(['--root', root]).code, 0);
    writeFileSync(join(root, '.pi/harness.config.json'), '{ "provider": "acme/" }\n');

    const result = runCli(['--root', root, '--check']);

    assert.equal(result.code, 0);
    assert.deepEqual(lines(result.stdout), ['шаблоны актуальны']);
  });

  test('--dry-run печатает план и ничего не пишет', (t) => {
    const root = makeProject(t);

    const result = runCli(['--root', root, '--dry-run']);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('.pi/agents/plan.md: создать'));
    assert.ok(result.stdout.includes('--dry-run: ничего не записано'));
    assert.equal(existsSync(join(root, '.pi', 'harness.version')), false);
    assert.equal(existsSync(join(root, '.pi', 'agents', 'plan.md')), false);
  });

  test('настройки pi не переписываются, но нарушение H5 видно', (t) => {
    const root = makeProject(t, {
      '.pi/settings.json': `${JSON.stringify({ subagents: { maxSubagentSpawnsPerRun: 3 } }, null, 2)}\n`,
      'AGENTS.md': 'Роли описаны в `.pi/agents/`.\n',
    });

    const result = runCli(['--root', root]);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('.pi/settings.json: не тронут, но H5 не выполнен'));
    assert.match(read(root, '.pi/settings.json'), /"maxSubagentSpawnsPerRun": 3/u);
    assert.ok(result.stdout.includes('H5: .pi/settings.json'), 'нарушение печатает проверка');
  });

  test('отчёт проверки раскладки: H6 и W2 видны после установки', (t) => {
    const root = makeProject(t, {
      'AGENTS.md': 'Роли: смотри `.pi/agents/`. Модель — `polza-ai/z-ai/glm-5.3-flash`.\n',
    });

    const result = runCli(['--root', root]);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('проверка раскладки: осталось поправить под проект:'));
    assert.ok(result.stdout.includes('H6: AGENTS.md — идентификаторы моделей'));
    assert.ok(result.stdout.includes('W2: .pi/agents/evaluate.md'), 'предупреждение I3 тоже видно');
  });

  test('чистый проект с AGENTS.md — отчёт без нарушений', (t) => {
    const root = makeProject(t, {
      'AGENTS.md': 'Роли описаны в `.pi/agents/`, гейты — в `.pi/harness.config.json`.\n',
    });

    const result = runCli(['--root', root]);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('проверка раскладки: нарушений нет'));
  });

  test('нет шаблонов и битая версия — код 2 с понятным текстом', (t) => {
    const root = makeProject(t);

    const noTemplates = runCli(['--root', root, '--templates', join(root, 'нет-таких')]);
    assert.equal(noTemplates.code, 2);
    assert.match(noTemplates.stderr, /harness-init: шаблоны не найдены/);

    mkdirSync(join(root, '.pi'), { recursive: true });
    writeFileSync(join(root, '.pi/harness.version'), '{ битый');
    const brokenVersion = runCli(['--root', root]);
    assert.equal(brokenVersion.code, 2);
    assert.match(
      brokenVersion.stderr,
      /harness-init: \.pi\/harness\.version: не читается как JSON/,
    );

    const unknown = runCli(['--root', root, '--нет-такого-флага']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /неизвестный аргумент/);
    assert.equal(existsSync(join(root, '.pi/agents')), false, 'отказы ничего не создают');
  });
});

/**
 * Профиль `harness/**`: конфиг лежит там же, где роли, промпт и настройки.
 * @param {import('node:test').TestContext} t
 * @returns {string} корень проекта
 */
function profileProject(t) {
  return makeProject(t, {
    'AGENTS.md': 'Роли описаны в `harness/agents/`, гейты — в `harness/harness.config.json`.\n',
    'harness/harness.config.json': `${JSON.stringify(
      {
        provider: 'polza-ai/',
        paths: {
          agentsDir: 'harness/agents',
          settings: 'harness/settings.json',
          cyclePrompt: 'harness/cycle.md',
        },
      },
      null,
      2,
    )}\n`,
  });
}

/** Конфиг профиля `harness/**` в терминах раскладки установки. */
const PROFILE_LAYOUT = Object.freeze({
  agentsDir: 'harness/agents',
  settings: 'harness/settings.json',
  cyclePrompt: 'harness/cycle.md',
  config: 'harness/harness.config.json',
  version: 'harness/harness.version',
});

describe('раскладка установки: профиль вместо литерала (ADR 0005, г)', () => {
  test('installLayout переводит пути конфига в пути установки', (t) => {
    const root = profileProject(t);
    const config = loadConfig(root, { file: 'harness/harness.config.json' });

    assert.deepEqual(installLayout(config, root), { ...PROFILE_LAYOUT });
  });

  test('умолчания установки совпадают с путями по умолчанию', () => {
    assert.deepEqual(defaultLayout(), {
      agentsDir: DEFAULTS.paths.agentsDir,
      settings: DEFAULTS.paths.settings,
      cyclePrompt: DEFAULTS.paths.cyclePrompt,
      config: '.pi/harness.config.json',
      version: '.pi/harness.version',
    });
  });

  test('collectTemplates раскладывает шаблоны по профилю', () => {
    const targets = collectTemplates(TEMPLATES, { ...PROFILE_LAYOUT }).map(
      (template) => template.target,
    );

    assert.deepEqual(targets, [
      'harness/agents/code.md',
      'harness/agents/evaluate.md',
      'harness/agents/plan.md',
      'harness/agents/review.md',
      'harness/cycle.md',
      'harness/harness.config.json',
    ]);
  });

  test('неизвестный шаблон — ошибка: профиль не знает, куда его ставить', () => {
    assert.equal(targetFor('agents/plan.md', { ...PROFILE_LAYOUT }), 'harness/agents/plan.md');
    assert.throws(
      () => targetFor('hooks/post-check.md', { ...PROFILE_LAYOUT }),
      /профиль раскладки не знает/u,
    );
  });

  test('конфиг вне корня проекта — ошибка установки', (t) => {
    const root = makeProject(t);
    const outside = join(tempDir(t), 'shared-harness.json');
    writeFileSync(outside, '{}\n');
    const config = loadConfig(root, { file: outside });

    assert.throws(() => installLayout(config, root), /конфиг вне корня проекта/u);
  });
});

describe('CLI: установка по профилю (#81)', () => {
  test('шаблоны ложатся по путям профиля, каталога умолчаний не появляется', (t) => {
    const root = profileProject(t);
    const configBefore = read(root, 'harness/harness.config.json');

    const result = runCli(['--root', root, '--config', 'harness/harness.config.json']);

    assert.equal(result.code, 0, result.stderr);
    for (const path of [
      'harness/agents/plan.md',
      'harness/agents/code.md',
      'harness/agents/review.md',
      'harness/agents/evaluate.md',
      'harness/cycle.md',
      'harness/settings.json',
      'harness/harness.version',
    ]) {
      assert.ok(existsSync(join(root, ...path.split('/'))), `${path} создан`);
    }
    assert.equal(existsSync(join(root, '.pi')), false, 'пути умолчаний не используются');
    assert.equal(read(root, 'harness/harness.config.json'), configBefore, 'конфиг — политика');
    assert.deepEqual(JSON.parse(read(root, 'harness/settings.json')), minimalSettings());
    // Конфиг существовал до установки и принадлежит проекту: провенанс не наш, в версию не
    // попадает — иначе `--force` однажды объявил бы чужие настройки шаблоном.
    assert.deepEqual(Object.keys(JSON.parse(read(root, 'harness/harness.version')).templates), [
      'harness/agents/code.md',
      'harness/agents/evaluate.md',
      'harness/agents/plan.md',
      'harness/agents/review.md',
      'harness/cycle.md',
    ]);
  });

  test('повторный запуск идемпотентен, --check согласован', (t) => {
    const root = profileProject(t);
    assert.equal(runCli(['--root', root, '--config', 'harness/harness.config.json']).code, 0);
    const versionBefore = read(root, 'harness/harness.version');

    const second = runCli(['--root', root, '--config', 'harness/harness.config.json']);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(read(root, 'harness/harness.version'), versionBefore, 'версия не перезаписана');

    const check = runCli(['--root', root, '--config', 'harness/harness.config.json', '--check']);
    assert.equal(check.code, 0, check.stdout);
    assert.deepEqual(lines(check.stdout), ['шаблоны актуальны']);
  });

  test('check-harness видит то же дерево, что установила команда', (t) => {
    const root = profileProject(t);
    assert.equal(runCli(['--root', root, '--config', 'harness/harness.config.json']).code, 0);

    const check = runScript(CHECK_SCRIPT, [
      '--root',
      root,
      '--config',
      'harness/harness.config.json',
    ]);

    assert.equal(check.code, 0, `${check.stdout}${check.stderr}`);
    assert.equal(check.stdout, '', 'нарушений нет');
  });

  test('конфига ещё нет: он создаётся по --config, версия ложится рядом с ним', (t) => {
    const root = makeProject(t);

    const result = runCli(['--root', root, '--config', 'config/harness.config.json']);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(existsSync(join(root, 'config/harness.config.json')), 'конфиг создан по флагу');
    assert.ok(existsSync(join(root, 'config/harness.version')), 'версия рядом с конфигом');
    // Пример конфига задаёт пути умолчаний: шаблоны едут туда, куда указывает сам конфиг.
    assert.ok(existsSync(join(root, '.pi/agents/plan.md')));

    const check = runCli(['--root', root, '--config', 'config/harness.config.json', '--check']);
    assert.equal(check.code, 0, check.stdout);
  });

  test('--config без значения — код 2', (t) => {
    const root = makeProject(t);

    const result = runCli(['--root', root, '--config']);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /--config: ожидается путь к файлу конфига/u);
  });
});
