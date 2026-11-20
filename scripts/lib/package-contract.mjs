/**
 * Контракт архива пакета (issue #72): что обязано в него попасть, чего в нём быть не дожжно и
 * какие обещания `package.json` проверяются на самом архиве.
 *
 * Зачем отдельный модуль. Состав архива проверяют двое: тест `package-consumer.test.mjs` — что
 * потребитель получает работоспособный пакет, и релизный workflow (`tooling/check-package.mjs`) —
 * что публикуется именно проверенное. Два списка разошлись бы на первой же правке `files`, а
 * ошибка в составе видна только у потребителя: в архиве не хватает `LICENSE`, шаблонов или
 * `types/`, и `harness-init`/`tsc` у него падают. Поэтому список и правила живут здесь, а
 * вызывающие только решают, как отчитаться о находках.
 *
 * Модуль не читает файлов: он получает имена файлов и разобранный `package.json` архива. Так его
 * проверяют без `pnpm pack`, а тест на реальном архиве остаётся один.
 *
 * Shebang не нужен: модуль подключается тестом и `tooling/check-package.mjs`.
 */
import { CONFIG_FILE, DEFAULTS } from './cycle/config.mjs';

/**
 * Пути умолчаний в архиве собираются из констант раскладки, а не пишутся литералами: шаблоны
 * пакета и фикстуры лежат по тем же путям, что и проект с умолчаниями (ADR 0005, г).
 */
const DEFAULT_CONFIG = `${CONFIG_FILE.dir}/${CONFIG_FILE.name}`;

/**
 * Что обязано быть в архиве, чтобы потребитель заработал: лицензия и доки, скрипты и данные
 * самотеста, типы потребителя, шаблоны установки, норматив.
 * @type {readonly string[]}
 */
export const REQUIRED_ENTRIES = Object.freeze([
  'LICENSE',
  'README.md',
  'package.json',
  'scripts/harness.mjs',
  'scripts/cycle-state.mjs',
  'scripts/check-harness.mjs',
  'scripts/selftest.mjs',
  `scripts/fixtures/cycle/project/${DEFAULT_CONFIG}`,
  'types/harness.d.mts',
  'types/cycle-state.d.mts',
  `templates/${CONFIG_FILE.dir}/agents/plan.md`,
  'docs/adr/README.md',
]);

/**
 * Чего в архиве быть не должно: локальные артефакты и инфраструктура репозитория.
 * @type {readonly string[]}
 */
export const FORBIDDEN_ENTRIES = Object.freeze([
  `${DEFAULTS.paths.artifactsDir}/`,
  'node_modules/',
  'evals/',
  'tooling/',
  '.github/',
  '.githooks/',
]);

/**
 * Пути, которые `exports`/`bin` обещают потребителю: без них установка формально успешна, а
 * импорт и `node_modules/.bin` падают у него, а не в CI.
 * @param {Record<string, unknown>} pkg разобранный `package.json`
 * @returns {string[]} пути внутри пакета (`./` срезан)
 */
export function promisedPaths(pkg) {
  /** @type {string[]} */
  const paths = [];

  const bin = pkg.bin;
  if (typeof bin === 'object' && bin !== null) {
    for (const target of Object.values(bin)) {
      if (typeof target === 'string') paths.push(target);
    }
  }

  const exports = pkg.exports;
  if (typeof exports === 'object' && exports !== null) {
    for (const [key, target] of Object.entries(exports)) {
      // Шаблонный ключ (`./templates/*`) файлов не обещает: его содержимое проверяет REQUIRED.
      if (key.includes('*')) continue;
      if (typeof target === 'string') {
        paths.push(target);
        continue;
      }
      if (typeof target !== 'object' || target === null) continue;
      for (const value of Object.values(target)) {
        if (typeof value === 'string') paths.push(value);
      }
    }
  }

  // `bin` и `exports` часто указывают на один файл: в находках он должен быть один раз.
  return [...new Set(paths.map((path) => path.replace(/^\.\//u, '')))].sort();
}

/**
 * Находки по составу архива.
 * @param {Iterable<string>} entries имена файлов архива без ведущего `package/`
 * @returns {string[]} проблемы; пустой список — архив полон
 */
export function archiveProblems(entries) {
  const present = new Set(entries);
  /** @type {string[]} */
  const problems = [];

  for (const path of REQUIRED_ENTRIES) {
    if (!present.has(path)) problems.push(`в архиве нет ${path} — сломан files или забыт файл`);
  }
  for (const prefix of FORBIDDEN_ENTRIES) {
    const leaked = [...present].filter((entry) => entry.startsWith(prefix));
    if (leaked.length > 0) problems.push(`в архив попало лишнее (${prefix}): ${leaked.join(', ')}`);
  }
  return problems;
}

/**
 * Находки по обещаниям `package.json` архива: имя, версия, наличие файлов `bin`/`exports`.
 * @param {object} options
 * @param {Record<string, unknown>} options.pkg `package.json` из архива
 * @param {Iterable<string>} options.entries имена файлов архива без ведущего `package/`
 * @param {{ name?: string, version?: string }} [options.expected] ожидаемые имя и версия
 * @returns {string[]} проблемы; пустой список — обещания выполнены
 */
export function packageProblems({ pkg, entries, expected = {} }) {
  const present = new Set(entries);
  /** @type {string[]} */
  const problems = [];

  if (expected.name !== undefined && pkg.name !== expected.name) {
    problems.push(`в архиве имя ${String(pkg.name)}, ожидалось ${expected.name}`);
  }
  if (expected.version !== undefined && pkg.version !== expected.version) {
    problems.push(
      `в архиве версия ${String(pkg.version)}, ожидалось ${expected.version} (тег и package.json расходятся)`,
    );
  }

  for (const path of promisedPaths(pkg)) {
    if (!present.has(path)) problems.push(`package.json обещает ${path}, а в архиве его нет`);
  }

  const bin = pkg.bin;
  if (typeof bin !== 'object' || bin === null || Object.keys(bin).length === 0) {
    problems.push('package.json без bin: потребителю нечем запускать команды');
  }

  return problems;
}
