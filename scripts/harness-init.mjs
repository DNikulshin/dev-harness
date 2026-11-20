#!/usr/bin/env node
/**
 * `harness-init` — установка шаблонов harness в проект одной командой (issue #41).
 *
 * Зачем: подключение проекта было ручным — скопировать `templates/.pi/agents/*.md`, промпт
 * цикла, конфиг из примера и вспомнить про `.pi/settings.json` с
 * `subagents.maxSubagentSpawnsPerRun` (без него `check-harness` красный по H5). Шагов пять,
 * пропустить можно любой, а проверить результат было нечем.
 *
 * Что делает:
 * 1. копирует `templates/.pi/**` в проект; `harness.config.example.json` → `.pi/harness.config.json`
 *    (имя примера в проекте не должно оставаться);
 * 2. пишет `.pi/harness.version` — версия пакета и `sha256` каждого установленного файла;
 * 3. обновляет шаблоны при смене версии пакета, но не затирает локальные правки без `--force`;
 * 4. создаёт минимальный `.pi/settings.json` с лимитом субагентов, если файла нет;
 * 5. в конце проверяет раскладку тем же кодом, что `check-harness`, и печатает, что осталось
 *    поправить под проект.
 *
 * Режимы:
 * ```
 * harness-init [--root DIR] [--templates DIR] [--dry-run] [--check] [--force]
 * ```
 * `--dry-run` — только план, без записи. `--check` — только отчёт о расхождениях. `--force` —
 * перезаписать и файлы с локальными правками. `--root` — проект (по умолчанию текущий каталог),
 * `--templates` — источник шаблонов (по умолчанию `templates/` пакета).
 *
 * Миграции без реестра версий: `.pi/harness.version` хранит дайджесты того, что поставили. Файл,
 * чей дайджест совпал с записанным, локально не правили — его можно обновить; не совпал — правили,
 * и решает владелец (`--force`). Файлы, которых больше нет в шаблонах, не удаляются: удалять
 * чужое по догадке хуже, чем сказать о нём.
 *
 * Коды выхода: `0` — план выполнен (в том числе когда всё уже актуально); `1` — есть
 * расхождения, которые команда не правила (локальные правки без `--force`, дрейф в `--check`);
 * `2` — ошибка использования или чтения (неизвестный аргумент, нет каталога шаблонов, битый
 * `.pi/harness.version`). Нарушения `check-harness` код не меняют: свежий шаблон заведомо не
 * знает проекта, и «осталось поправить» — это подсказка, а не провал установки.
 *
 * Shebang нужен: файл запускается напрямую.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeHarness, formatViolation, formatWarning, readHarness } from './check-harness.mjs';

import { isDirectRun } from './lib/cycle/cli.mjs';
import { loadConfig } from './lib/cycle/config.mjs';

/** Корень репозитория ядра: родитель каталога `scripts/`. */
const DEFAULT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Шаблоны пакета: отдаются потребителю вместе с пакетом (`files` в `package.json`). */
const DEFAULT_TEMPLATES = join(DEFAULT_ROOT, 'templates');

/** Префикс путей шаблонов: всё внутри `.pi/` копируется как есть. */
const TEMPLATE_PREFIX = '.pi/';

/**
 * Переименования при установке: пример конфига становится рабочим файлом проекта.
 * @type {Readonly<Record<string, string>>}
 */
export const RENAME_ON_INSTALL = Object.freeze({
  '.pi/harness.config.example.json': '.pi/harness.config.json',
});

/**
 * Файлы, которые после установки принадлежат проекту: конфиг — политика, а не шаблон.
 * Такой файл создаётся один раз и больше не обновляется даже `--force`: перезаписать
 * гейты и лимиты проекта примером из пакета — это тихая потеря настроек.
 * @type {ReadonlySet<string>}
 */
export const PROJECT_OWNED = new Set(Object.values(RENAME_ON_INSTALL));

/** Файл версии шаблонов: версия пакета и дайджесты установленного. */
export const VERSION_FILE = '.pi/harness.version';

/** Настройки pi, в которых живёт лимит субагентов (H5). */
export const SETTINGS_FILE = '.pi/settings.json';

/** Что говорят об установленном файле, которого больше нет в шаблонах. */
const REMOVED_HINT = 'не удаляется (нет в шаблонах)';

/** Минимальный лимит запусков субагентов за цикл (H5 в `check-harness`). */
const MIN_SUBAGENT_SPAWNS = 7;

/**
 * Аргументы CLI.
 * @typedef {{
 *   root: string,
 *   templates: string,
 *   dryRun: boolean,
 *   check: boolean,
 *   force: boolean,
 * }} InitArgs
 */

/**
 * Разбирает аргументы CLI. Неизвестный аргумент — ошибка: молча игнорировать флаг опаснее,
 * чем упасть (человек будет уверен, что `--dry-run` сработал).
 * @param {string[]} argv
 * @returns {InitArgs}
 */
export function parseArgs(argv) {
  /** @type {InitArgs} */
  const args = {
    root: process.cwd(),
    templates: DEFAULT_TEMPLATES,
    dryRun: false,
    check: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' || arg === '--templates') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg}: ожидается путь`);
      }
      if (arg === '--root') args.root = resolve(value);
      else args.templates = resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--check') {
      args.check = true;
      continue;
    }
    if (arg === '--force') {
      args.force = true;
      continue;
    }
    throw new Error(`неизвестный аргумент: ${arg}`);
  }

  return args;
}

/**
 * `sha256` содержимого в единой форме — так его пишут и сравнивают.
 * @param {string} text
 * @returns {string}
 */
export function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Переводит путь ОС в путь проекта (`/`), чтобы `.pi/harness.version` не зависел от платформы.
 * @param {string} path
 * @returns {string}
 */
function toPosix(path) {
  return sep === '/' ? path : path.split(sep).join('/');
}

/**
 * Собирает шаблоны для установки: всё из `<templatesDir>/.pi/**` с учётом переименований.
 * @param {string} templatesDir каталог шаблонов (в пакете — `templates/`)
 * @returns {{ source: string, target: string, text: string, digest: string }[]}
 *   `source` — путь внутри `templates/`, `target` — путь в проекте; порядок стабильный
 */
export function collectTemplates(templatesDir) {
  const start = join(templatesDir, '.pi');
  if (!existsSync(start) || !statSync(start).isDirectory()) {
    throw new Error(
      `шаблоны не найдены: ${toPosix(relative(templatesDir, start))} в ${templatesDir}`,
    );
  }

  /** @type {{ source: string, target: string, text: string, digest: string }[]} */
  const files = [];
  for (const source of walkFiles(start)) {
    const sourcePath = `${TEMPLATE_PREFIX}${toPosix(relative(start, source))}`;
    const target = RENAME_ON_INSTALL[sourcePath] ?? sourcePath;
    const text = readFileSync(source, 'utf8');
    files.push({ source: sourcePath, target, text, digest: digest(text) });
  }

  return files.sort((left, right) => left.target.localeCompare(right.target));
}

/**
 * Рекурсивный обход файлов в стабильном порядке.
 * @param {string} dir
 * @returns {string[]} абсолютные пути
 */
function walkFiles(dir) {
  /** @type {string[]} */
  const found = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/**
 * Читает `.pi/harness.version`. Нет файла — пустая запись (первая установка).
 * Битый файл — ошибка чтения: по нему решается, правили ли шаблоны, и догадка здесь
 * означала бы «затрём, наверное, не жалко».
 * @param {string} file
 * @returns {{ version: string | null, templates: Record<string, string> }}
 */
export function readVersionFile(file) {
  if (!existsSync(file)) return { version: null, templates: {} };

  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${VERSION_FILE}: не читается как JSON: ${reason}`);
  }

  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error(`${VERSION_FILE}: ожидается объект`);
  }

  const record = /** @type {Record<string, unknown>} */ (doc);
  const version = typeof record.version === 'string' ? record.version : null;
  const templates = record.templates;
  if (typeof templates !== 'object' || templates === null || Array.isArray(templates)) {
    throw new Error(`${VERSION_FILE}: поле templates должно быть объектом`);
  }

  /** @type {Record<string, string>} */
  const digests = {};
  for (const [path, value] of Object.entries(templates)) {
    if (typeof value !== 'string') {
      throw new Error(`${VERSION_FILE}: templates[${JSON.stringify(path)}] должен быть строкой`);
    }
    digests[path] = value;
  }

  return { version, templates: digests };
}

/**
 * Состояние одного файла установки.
 * @typedef {'create'|'update'|'current'|'modified'|'owned'} TargetState
 *   `create` — файла нет; `update` — локальных правок нет, шаблон новее; `current` — совпадает;
 *   `modified` — файл правили, без `--force` не трогаем; `owned` — файл принадлежит проекту
 *   (конфиг) и, раз он уже есть, не обновляется никогда.
 */

/**
 * План установки: что сделать с каждым шаблоном. Чистая функция по отношению к файловой
 * системе проекта — ничего не пишет, поэтому годится и для `--dry-run`, и для `--check`.
 * @param {object} options
 * @param {string} options.root каталог проекта
 * @param {{ source: string, target: string, text: string, digest: string }[]} options.templates
 * @param {Record<string, string>} options.recorded дайджесты из `.pi/harness.version`
 * @returns {{ entries: { target: string, state: TargetState, text: string, digest: string }[], removed: string[] }}
 */
export function planInstall({ root, templates, recorded }) {
  const entries = templates.map((template) => {
    const file = join(root, ...template.target.split('/'));
    const onDisk = existsSync(file) ? readFileSync(file, 'utf8') : null;
    /** @type {TargetState} */
    let state;
    if (onDisk === null) {
      state = 'create';
    } else if (PROJECT_OWNED.has(template.target)) {
      state = 'owned';
    } else if (digest(onDisk) === template.digest) {
      state = 'current';
    } else {
      // Файл отличается от шаблона: правку руками отличаем от старой версии по записи.
      const recordedDigest = recorded[template.target];
      state =
        recordedDigest !== undefined && recordedDigest === digest(onDisk) ? 'update' : 'modified';
    }
    return { target: template.target, state, text: template.text, digest: template.digest };
  });

  const known = new Set(templates.map((template) => template.target));
  const removed = Object.keys(recorded)
    .filter((target) => !known.has(target))
    .sort((left, right) => left.localeCompare(right));

  return { entries, removed };
}

/**
 * Лимит субагентов из `.pi/settings.json`.
 * @param {string} file
 * @returns {{ state: 'absent'|'current'|'low'|'invalid'|'unreadable', value: number | null }}
 *   `absent` — файла нет (создадим); `current` — лимит ≥ 7; `low` — меньше нормы (H5);
 *   `invalid` — поле не целое число; `unreadable` — файл есть, но это не JSON-объект
 */
export function readSettingsState(file) {
  if (!existsSync(file)) return { state: 'absent', value: null };

  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { state: 'unreadable', value: null };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { state: 'unreadable', value: null };
  }

  const subagents = /** @type {Record<string, unknown>} */ (doc).subagents;
  if (typeof subagents !== 'object' || subagents === null || Array.isArray(subagents)) {
    return { state: 'low', value: null };
  }
  const value = /** @type {Record<string, unknown>} */ (subagents).maxSubagentSpawnsPerRun;
  if (value === undefined) return { state: 'low', value: null };
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { state: 'invalid', value: null };
  }
  return { state: value >= MIN_SUBAGENT_SPAWNS ? 'current' : 'low', value };
}

/**
 * Минимальные настройки: только то, чего требует H5. Остальное — дело проекта и pi.
 * @returns {Record<string, unknown>}
 */
export function minimalSettings() {
  return { subagents: { maxSubagentSpawnsPerRun: MIN_SUBAGENT_SPAWNS } };
}

/**
 * Документ `.pi/harness.version`: версия пакета и дайджесты того, что поставили.
 *
 * Пропущенный файл (локальная правка без `--force`) сохраняет прежний дайджест или не попадает
 * в запись вовсе: записать его текущее содержимое значило бы объявить чужую правку «нашей» и
 * затереть её при следующем обновлении.
 * @param {{
 *   version: string,
 *   templates: { target: string, state: TargetState, digest: string }[],
 *   recorded: Record<string, string>,
 *   force: boolean,
 * }} options
 * @returns {Record<string, unknown>}
 */
export function buildVersionDoc({ version, templates, recorded, force }) {
  /** @type {Record<string, string>} */
  const digests = {};
  for (const template of [...templates].sort((left, right) =>
    left.target.localeCompare(right.target),
  )) {
    if (template.state === 'modified' && !force) {
      const previous = recorded[template.target];
      if (previous !== undefined) digests[template.target] = previous;
      continue;
    }
    if (template.state === 'owned') {
      const previous = recorded[template.target];
      if (previous !== undefined) digests[template.target] = previous;
      continue;
    }
    digests[template.target] = template.digest;
  }
  return { version, templates: digests };
}

/**
 * Версия пакета: единственный источник — `package.json` рядом со `scripts/`.
 * @param {string} root корень ядра
 * @returns {string}
 */
export function packageVersion(root) {
  const file = join(root, 'package.json');
  try {
    const doc = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(file, 'utf8')));
    return typeof doc.version === 'string' ? doc.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Установка шаблонов в проект.
 *
 * Побочные эффекты внедряются (`io.write`/`io.log`), чтобы тесты проверяли план и текст вывода,
 * не трогая дерево проекта.
 * @param {InitArgs} args
 * @param {{ write?: (file: string, text: string) => void, log?: (line: string) => void }} [io]
 * @returns {{ code: number, lines: string[] }}
 */
export function runInit(args, io = {}) {
  const log = io.log ?? (() => {});
  const write = io.write ?? ((file, text) => writeFileSync(file, text));

  const templates = collectTemplates(args.templates);
  const versionPath = join(args.root, ...VERSION_FILE.split('/'));
  const recorded = readVersionFile(versionPath).templates;
  const plan = planInstall({ root: args.root, templates, recorded });

  /** @type {string[]} */
  const lines = [];
  /**
   * @param {string} line
   * @returns {void}
   */
  const emit = (line) => {
    lines.push(line);
    log(line);
  };

  const blocked = plan.entries.filter((entry) => entry.state === 'modified');

  if (args.check) {
    const drifted = plan.entries.filter(
      (entry) => entry.state !== 'current' && entry.state !== 'owned',
    );
    for (const entry of drifted) {
      // Конфиг проекта `--check` не сверяет: он больше не шаблон, и его расхождение
      // с примером — норма, а не дрейф (иначе код 1 на каждом здоровом проекте).
      emit(`${entry.target}: ${describeState(entry.state, true)}`);
    }
    for (const target of plan.removed) {
      emit(`${target}: ${REMOVED_HINT}`);
    }
    if (drifted.length === 0) emit('шаблоны актуальны');
    return { code: drifted.length === 0 ? 0 : 1, lines };
  }

  if (args.dryRun) {
    emit(`корень проекта: ${args.root}`);
    for (const entry of plan.entries) {
      if (entry.state === 'current' || entry.state === 'owned') continue;
      emit(`${entry.target}: ${describeState(entry.state, false)}`);
    }
    for (const target of plan.removed) {
      emit(`${target}: ${REMOVED_HINT}`);
    }
    const actions = plan.entries.filter(
      (entry) => entry.state === 'create' || entry.state === 'update' || entry.state === 'modified',
    );
    if (actions.length === 0) emit('изменений нет');
    emit('--dry-run: ничего не записано');
    return { code: blocked.length > 0 ? 1 : 0, lines };
  }

  for (const entry of plan.entries) {
    const file = join(args.root, ...entry.target.split('/'));
    if (entry.state === 'create' || entry.state === 'update') {
      mkdirSync(dirname(file), { recursive: true });
      write(file, entry.text);
      emit(`${entry.state === 'create' ? 'создан' : 'обновлён'}: ${entry.target}`);
      continue;
    }
    if (entry.state === 'owned') {
      emit(`${entry.target}: конфиг проекта, не меняется`);
      continue;
    }
    if (entry.state === 'modified') {
      if (args.force) {
        write(file, entry.text);
        emit(`перезаписан (--force): ${entry.target}`);
        continue;
      }
      emit(`${entry.target}: пропущен — правили локально, нужен --force`);
    }
  }

  // `.pi/settings.json` — файл pi, а не наш: создаём только при отсутствии, чужое не трогаем.
  const settingsPath = join(args.root, ...SETTINGS_FILE.split('/'));
  const settings = readSettingsState(settingsPath);
  if (settings.state === 'absent') {
    mkdirSync(dirname(settingsPath), { recursive: true });
    write(settingsPath, `${JSON.stringify(minimalSettings(), null, 2)}\n`);
    emit(`создан: ${SETTINGS_FILE} (subagents.maxSubagentSpawnsPerRun = ${MIN_SUBAGENT_SPAWNS})`);
  } else if (settings.state === 'current') {
    emit(`${SETTINGS_FILE}: лимит субагентов в порядке`);
  } else {
    const detail =
      settings.state === 'low'
        ? `maxSubagentSpawnsPerRun = ${settings.value === null ? 'не задан' : settings.value},` +
          ` требуется ≥ ${MIN_SUBAGENT_SPAWNS}`
        : settings.state === 'invalid'
          ? 'maxSubagentSpawnsPerRun должен быть целым'
          : 'файл не разбирается как JSON-объект';
    emit(`${SETTINGS_FILE}: не тронут, но H5 не выполнен — ${detail}`);
  }

  for (const target of plan.removed) {
    emit(`${target}: ${REMOVED_HINT}`);
  }

  // Версия шаблонов пишется всегда, даже когда всё актуально: так фиксируется версия пакета,
  // от которой считается следующая миграция. Дайджест пропущенного файла остаётся прежним —
  // записать его содержимое значило бы объявить чужую правку «нашей» и затереть её при
  // следующем обновлении.
  const version = packageVersion(DEFAULT_ROOT);
  const versionDoc = buildVersionDoc({
    version,
    templates: plan.entries,
    recorded,
    force: args.force,
  });
  const nextVersionText = `${JSON.stringify(versionDoc, null, 2)}\n`;
  const currentVersionText = existsSync(versionPath) ? readFileSync(versionPath, 'utf8') : null;
  if (currentVersionText !== nextVersionText) {
    write(versionPath, nextVersionText);
    emit(`записан: ${VERSION_FILE} (версия ${version})`);
  }

  printReport(args.root, emit);
  // Точная команда: у `check-harness` без `--root` корень — каталог пакета, а не проект.
  emit('проверить отдельно: harness-check-layout --root .');

  return { code: blocked.length > 0 && !args.force ? 1 : 0, lines };
}

/**
 * Человеческая формулировка состояния файла.
 * @param {TargetState} state
 * @param {boolean} forCheck отчёт `--check` говорит о расхождении, а не о действии
 * @returns {string}
 */
function describeState(state, forCheck) {
  if (state === 'create') return forCheck ? 'нет в проекте' : 'создать';
  if (state === 'owned') return 'конфиг проекта, не сверяется с шаблоном';
  if (state === 'modified') {
    return forCheck ? 'правили локально, шаблон другой' : 'пропустить (правили локально)';
  }
  if (state === 'update') {
    return forCheck ? 'устарел относительно пакета' : 'обновить';
  }
  return 'без изменений';
}

/**
 * Отчёт проверки раскладки: тот же код, что `check-harness`, без подпроцесса.
 * @param {string} root
 * @param {(line: string) => void} emit
 * @returns {void}
 */
function printReport(root, emit) {
  /** @type {import('./check-harness.mjs').Violation[]} */
  let violations;
  /** @type {import('./check-harness.mjs').Warning[]} */
  let warnings;
  try {
    const config = loadConfig(root);
    const agentsMd = join(root, ...config.paths.agentsMd.split('/'));
    if (!existsSync(agentsMd)) {
      // Без `AGENTS.md` проверка раскладки бессмысленна: это правила проекта, и их пишет
      // человек. Подсказка честнее сообщения «файл не найден» из недр `readHarness`.
      emit(`проверка раскладки не выполнена: нет ${config.paths.agentsMd} — создайте его`);
      return;
    }
    const { violations: found, warnings: warned } = analyzeHarness(readHarness(root, config));
    violations = found;
    warnings = warned;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    emit(`проверка раскладки не выполнена: ${reason}`);
    return;
  }

  for (const warning of warnings) emit(formatWarning(warning));
  if (violations.length === 0) {
    emit('проверка раскладки: нарушений нет');
    return;
  }
  emit('проверка раскладки: осталось поправить под проект:');
  for (const violation of violations) emit(`  ${formatViolation(violation)}`);
}

/** Тонкий CLI: план и отчёт в stdout, диагностика — в stderr. */
function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { code } = runInit(args, { log: (line) => process.stdout.write(`${line}\n`) });
    process.exitCode = code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`harness-init: ${message}\n`);
    process.exitCode = 2;
  }
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) main();
