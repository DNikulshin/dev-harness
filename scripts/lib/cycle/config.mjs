/**
 * Конфигурация проекта для ядра цикла.
 *
 * Ядро не знает конкретный проект: гейты, лимиты, пути и провайдер моделей приходят из
 * `<root>/.pi/harness.config.json`. Здесь только загрузчик и нейтральные значения по
 * умолчанию. Гейтов в дефолтах нет: проект без секции `gates` — валидное состояние,
 * `cycle-gates` сообщает «гейты не заданы» и завершается кодом 2.
 *
 * «Где конфиг» — единственная фиксированная точка раскладки (ADR 0005, б): по умолчанию
 * `<root>/<dir>/<name>` из `CONFIG_FILE`, иначе путь из `--config`/`HARNESS_CONFIG`
 * (граница CLI — `takeConfigOption`). Всё остальное приходит из секций конфига. Сообщения
 * называют фактический путь (`configFile`), а не литерал: ошибка в
 * `harness/harness.config.json` не должна отправлять читателя в несуществующий `.pi/`.
 *
 * Ошибки конфига — `ConfigError` с `code = 2`: неизвестная секция или поле, неверный тип,
 * отрицательное число, пустой `id`, дубли `id`, отсутствующий `executable` не превращаются
 * в молчаливый дефолт. Тексты ошибок не содержат содержимого файлов, поэтому `.env*` и
 * другие секреты в диагностику не попадают.
 *
 * Секция `integrity` (#27) — правила путей для контроля целостности проверок: `testPaths`
 * (файлы тестов) и `protectedPaths` (файлы, которые агент не должен править молча). Правило —
 * относительный путь или glob с `*` (внутри сегмента) и `**` (через сегменты); правило без
 * wildcard задевает и всё внутри каталога. Пустая секция — валидное состояние: контроля нет.
 *
 * Обратная совместимость: гейт со строковым `cmd` (старый формат) разбирается по пробелам,
 * о чём печатается предупреждение в stderr. Новый формат — `executable` + `args`, без
 * оболочки: аргументы не интерполируются.
 *
 * Shebang не нужен: модуль подключается из CLI-скриптов `cycle-*.mjs` и `evals-*.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Имя файла конфигурации относительно корня проекта. */
export const CONFIG_FILE = Object.freeze({ dir: '.pi', name: 'harness.config.json' });

/** Флаг границы CLI: путь к файлу конфига (ADR 0005, б). */
export const CONFIG_FLAG = '--config';

/** Переменная окружения для случаев, где флаг передать некуда; флаг важнее её. */
export const CONFIG_ENV = 'HARNESS_CONFIG';

/**
 * Метка конфига по умолчанию: путь по умолчанию, собранный из `CONFIG_FILE`, а не литерал.
 * Она же — стартовое значение `label()`, пока загрузчик не знает фактический путь.
 * @returns {string}
 */
function defaultLabel() {
  return `${CONFIG_FILE.dir}/${CONFIG_FILE.name}`;
}

/** Ошибка конфигурации: код 2 у скриптов цикла — ошибка использования, а не падение. */
export class ConfigError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.code = 2;
  }
}

/**
 * Метка файла, который разбирается прямо сейчас: фактический путь конфига в сообщениях.
 *
 * Состояние модуля, а не параметр каждой функции разбора: сообщений около тридцати, а
 * `loadConfig` — единственная точка входа и вызывает разбор синхронно, без реентерабельности
 * (внутри нет ни `await`, ни повторного `loadConfig`). Прежнее значение возвращается в
 * `finally`, поэтому вложенный вызов не оставит за собой чужую метку.
 * @returns {string}
 */
function label() {
  return activeLabel;
}

/** @type {string} */
let activeLabel = defaultLabel();

/** Встроенные гейты ядра: единственное значение `builtin`, известное `cycle-gates`. */
export const BUILTIN_GATES = Object.freeze(['secrets_scan']);

/** Провайдер моделей по умолчанию: нейтральный префикс, проверяется правилом H4. */
const DEFAULT_PROVIDER = 'acme-ai/';

/**
 * Нейтральные значения по умолчанию. Гейтов здесь нет намеренно: список проверок —
 * свойство проекта, а не ядра.
 */
export const DEFAULTS = deepFreeze({
  gates: [],
  limits: {
    maxDiffLines: 2000,
    maxDiffBytes: 400 * 1024,
    logMaxBytes: 5 * 1024 * 1024,
    evidenceTailLines: 200,
    defaultMaxIterations: 2,
    maxCycleCostRub: 30,
  },
  paths: {
    artifactsDir: '.pi/artifacts',
    evidenceDir: 'evidence',
    gatesDir: 'gates',
    agentsDir: '.pi/agents',
    agentsMd: 'AGENTS.md',
    settings: '.pi/settings.json',
    cyclePrompt: '.pi/prompts/cycle.md',
    prTemplate: '',
  },
  qaWeb: {
    pathPrefixes: [],
  },
  evals: {
    prices: 'evals/prices.json',
    profiles: 'evals/profiles.json',
    candidates: 'evals/candidates.json',
    seedsDir: 'evals/orchestrator/seeds',
  },
  integrity: {
    testPaths: [],
    protectedPaths: [],
  },
  provider: DEFAULT_PROVIDER,
  gateTimeouts: {},
});

/**
 * @typedef {object} LoadedGate
 * @property {string} id
 * @property {string|null} executable команда без оболочки (`null` — встроенная проверка)
 * @property {readonly string[]} args аргументы без интерполяции
 * @property {string|null} cmd команда строкой для `gates.<n>.json` (`null` — builtin)
 * @property {string|null} builtin встроенная проверка ядра
 * @property {boolean} required
 * @property {readonly string[]} dependsOn
 * @property {readonly string[]} pathPrefixes
 * @property {boolean} dbGate класс отказа по логу: нет базы → `not_run` с `no_database`
 * @property {GateEnv|null} env объявленное окружение гейта (`null` — полное наследование)
 */

/**
 * Объявленное окружение гейта (ADR 0007): объявил `env` — наследование выключается, гейт получает
 * только `allow`-переменные, литеральные `set` и служебные; не объявил — наследует всё, как раньше.
 * @typedef {object} GateEnv
 * @property {readonly string[]} allow имена переменных, наследуемых из окружения вызывающего
 * @property {Readonly<Record<string, string>>} set литеральные значения (не секреты: конфиг в git)
 */

/**
 * Лимиты цикла: значения, а не источники. Набор ключей фиксирован схемой конфига —
 * неизвестный ключ отвергается валидацией, поэтому расширение идёт правкой этого типа.
 * @typedef {object} Limits
 * @property {number} maxDiffLines
 * @property {number} maxDiffBytes
 * @property {number} logMaxBytes
 * @property {number} evidenceTailLines
 * @property {number} defaultMaxIterations
 * @property {number} maxCycleCostRub
 */

/**
 * Пути раскладки: относительные к корню проекта.
 * @typedef {object} Paths
 * @property {string} artifactsDir
 * @property {string} evidenceDir
 * @property {string} gatesDir
 * @property {string} agentsDir
 * @property {string} agentsMd
 * @property {string} settings
 * @property {string} cyclePrompt
 * @property {string} prTemplate пустая строка — шаблон PR не задан
 */

/**
 * Пути evals-слоя.
 * @typedef {object} EvalsPaths
 * @property {string} prices
 * @property {string} profiles
 * @property {string} candidates
 * @property {string} seedsDir
 */

/**
 * Правила путей контроля целостности: что считать тестами и что — защищённым файлом.
 * @typedef {object} IntegrityRules
 * @property {readonly string[]} testPaths правила путей тестов
 * @property {readonly string[]} protectedPaths правила защищённых файлов
 */

/** Допустимые секции конфига: всё остальное — ошибка, а не игнор. */
const SECTIONS = Object.freeze([
  'gates',
  'limits',
  'paths',
  'evals',
  'qaWeb',
  'integrity',
  'provider',
  'gateTimeouts',
]);

/** Поля секций: неизвестное поле ловится до слияния с дефолтами. */
const SECTION_FIELDS = Object.freeze({
  limits: Object.freeze([
    'maxDiffLines',
    'maxDiffBytes',
    'logMaxBytes',
    'evidenceTailLines',
    'defaultMaxIterations',
    'maxCycleCostRub',
  ]),
  paths: Object.freeze([
    'artifactsDir',
    'evidenceDir',
    'gatesDir',
    'agentsDir',
    'agentsMd',
    'settings',
    'cyclePrompt',
    'prTemplate',
  ]),
  evals: Object.freeze(['prices', 'profiles', 'candidates', 'seedsDir']),
  qaWeb: Object.freeze(['pathPrefixes']),
  integrity: Object.freeze(['testPaths', 'protectedPaths']),
});

/** Поля гейта; `cmd` допускается только для старого формата. */
const GATE_FIELDS = Object.freeze([
  'id',
  'executable',
  'args',
  'cmd',
  'builtin',
  'required',
  'dependsOn',
  'pathPrefixes',
  'dbGate',
  'env',
]);

/** Уже напечатанные предупреждения: один и тот же конфиг не спамит при каждом вызове. */
const warned = new Set();

/**
 * Плоский объект: массивы и `null` объектами не считаются.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>} сужает тип вызывающего кода
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Непустая строка.
 * @param {unknown} value
 * @returns {value is string} сужает тип вызывающего кода
 */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Глубокая заморозка: конфиг не должен меняться в рантайме.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

/**
 * Читает JSON конфига. Отсутствие файла — не ошибка, пока путь не задан явно: работают
 * дефолты. Явный путь (`--config`/`HARNESS_CONFIG`) — обещание пользователя, поэтому
 * отсутствующий файл — ошибка, а не молчаливые дефолты: опечатка в пути иначе выглядит
 * как «настройки применились».
 * @param {string} file абсолютный путь к конфигу
 * @param {boolean} explicit путь задан снаружи (флаг или окружение)
 * @param {boolean} allowMissing вызывающий создаёт файл по этому пути (`harness-init`)
 * @returns {unknown}
 */
function readConfigFile(file, explicit, allowMissing) {
  if (!existsSync(file)) {
    if (!explicit || allowMissing) return null;
    throw new ConfigError(evalLabel('файл конфига не найден'));
  }
  const text = readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new ConfigError(evalLabel('битый JSON'));
  }
}

/**
 * Абсолютный путь конфига и его метка для диагностики.
 * @param {string} root корень проекта
 * @param {string|null} file путь из `--config`/окружения (`null` — умолчание)
 * @returns {{ file: string, label: string }}
 */
export function resolveConfigPath(root, file = null) {
  const absolute =
    file === null ? join(root, CONFIG_FILE.dir, CONFIG_FILE.name) : resolve(root, file);
  return { file: absolute, label: displayPath(root, absolute) };
}

/**
 * Метка пути для диагностики: путь от корня проекта, если он внутри него, иначе абсолютный.
 * Умолчание даёт `CONFIG_FILE.dir/CONFIG_FILE.name`, а конфиг снаружи дерева
 * (`--config ../shared/harness.json`) называется своим абсолютным путём — префикс
 * `../../` в сообщении читателя не спасает.
 * @param {string} root корень проекта
 * @param {string} absolute абсолютный путь
 * @returns {string}
 */
function displayPath(root, absolute) {
  const rel = relative(root, absolute);
  const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  return inside ? rel.split(sep).join('/') : absolute;
}

/**
 * Забирает из аргументов CLI флаг `--config <file>` (и его форму `--config=<file>`), а из
 * окружения — `HARNESS_CONFIG`. Один резолвер на все `bin` (ADR 0005, б): остальные
 * парсеры аргументов флага не знают и увидят аргументы уже без него.
 *
 * Приоритет: флаг важнее окружения — явное действие сильнее настроенной среды. Флаг без
 * значения, заданный дважды, `--config=` с пустым значением — ошибка с кодом 2, а не
 * молчаливый откат к умолчанию. Пустой `HARNESS_CONFIG` считается незаданным: пустую
 * переменную легко получить из окружения, где её выключили.
 * @param {readonly string[]} [argv] аргументы CLI
 * @param {Record<string, string|undefined>} [env] окружение
 * @returns {{ file: string|null, argv: string[] }} путь конфига и аргументы без флага
 */
export function takeConfigOption(argv = process.argv.slice(2), env = process.env) {
  /** @type {string|null} */
  let file = null;
  /** @type {string[]} */
  const rest = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const inline = arg.startsWith(`${CONFIG_FLAG}=`) ? arg.slice(CONFIG_FLAG.length + 1) : null;
    if (arg !== CONFIG_FLAG && inline === null) {
      rest.push(arg);
      continue;
    }
    if (file !== null) {
      throw new ConfigError(`${CONFIG_FLAG}: флаг задан больше одного раза`);
    }
    const value = inline ?? argv[index + 1];
    if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
      throw new ConfigError(`${CONFIG_FLAG}: ожидается путь к файлу конфига`);
    }
    file = value.trim();
    if (inline === null) index += 1;
  }

  if (file !== null) return { file, argv: rest };

  const fromEnv = env[CONFIG_ENV];
  const envFile = typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : null;
  return { file: envFile, argv: rest };
}

/**
 * Метка файла для диагностики: фактический путь конфига (метка `label()`), без
 * содержимого файла. Дефолтный конфиг называется относительным путём от корня проекта,
 * конфиг вне дерева — абсолютным (`displayPath`).
 * @param {string} reason
 * @returns {string}
 */
function evalLabel(reason) {
  return `${label()}: ${reason}`;
}

/**
 * Проверяет, что в секции нет неизвестных полей.
 * @param {Record<string, unknown>} section
 * @param {string} name
 * @param {readonly string[]} allowed
 * @returns {void}
 */
function assertKnownFields(section, name, allowed) {
  for (const key of Object.keys(section)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(`${label()}: неизвестное поле ${name}.${key}`);
    }
  }
}

/**
 * Число из секции: конечное, не меньше нуля (для лимитов — строго больше нуля).
 * @param {unknown} value
 * @param {string} path
 * @param {{ positive?: boolean }} [options]
 * @returns {number}
 */
function numberField(value, path, { positive = true } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`${label()}: ${path} — ожидается число`);
  }
  if (value < 0 || (positive && value === 0)) {
    throw new ConfigError(`${label()}: ${path} — ожидается положительное число`);
  }
  return value;
}

/**
 * Строка пути/значения: непустая, если пустая не разрешена.
 * @param {unknown} value
 * @param {string} path
 * @param {{ allowEmpty?: boolean }} [options]
 * @returns {string}
 */
function stringField(value, path, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !isText(value))) {
    throw new ConfigError(`${label()}: ${path} — ожидается непустая строка`);
  }
  return value;
}

/**
 * Секция `limits`: каждое поле — положительное число, лишние поля запрещены.
 * @param {unknown} value
 * @returns {{ limits: Limits, explicit: readonly string[] }}
 *   `explicit` — ключи, заданные в файле: они и только они имеют источник `config`
 *   (остальные пришли из дефолтов ядра, и `applied_limits` не должен выдавать их за проектные)
 */
function parseLimits(value) {
  if (!isRecord(value)) {
    throw new ConfigError(`${label()}: limits — ожидается объект`);
  }
  assertKnownFields(value, 'limits', SECTION_FIELDS.limits);

  /** @type {Limits} */
  const limits = { ...DEFAULTS.limits };
  for (const [key, raw] of Object.entries(value)) {
    // Ключ уже проверен `assertKnownFields` по `SECTION_FIELDS.limits`, то есть по схеме.
    limits[/** @type {keyof Limits} */ (key)] = numberField(raw, `limits.${key}`);
  }
  return { limits, explicit: Object.keys(value) };
}

/**
 * Секция `paths`: строки, `prTemplate` может быть пустой (шаблон не задан).
 * @param {unknown} value
 * @returns {Paths}
 */
function parsePaths(value) {
  if (!isRecord(value)) {
    throw new ConfigError(`${label()}: paths — ожидается объект`);
  }
  assertKnownFields(value, 'paths', SECTION_FIELDS.paths);

  /** @type {Paths} */
  const paths = { ...DEFAULTS.paths };
  for (const [key, raw] of Object.entries(value)) {
    // Ключ уже проверен `assertKnownFields` по `SECTION_FIELDS.paths`, то есть по схеме.
    paths[/** @type {keyof Paths} */ (key)] = stringField(raw, `paths.${key}`, {
      allowEmpty: key === 'prTemplate',
    });
  }
  return paths;
}

/**
 * Секция `qaWeb`: префиксы путей, по которым дифф считается затрагивающим web (§5.6, п. 4).
 * Пустой список — проект не просит браузерную проверку.
 * @param {unknown} value
 * @returns {{pathPrefixes: string[]}}
 */
function parseQaWeb(value) {
  if (!isRecord(value)) {
    throw new ConfigError(`${label()}: qaWeb — ожидается объект`);
  }
  assertKnownFields(value, 'qaWeb', SECTION_FIELDS.qaWeb);

  const pathPrefixes =
    value.pathPrefixes === undefined
      ? [...DEFAULTS.qaWeb.pathPrefixes]
      : stringList(value.pathPrefixes, 'qaWeb.pathPrefixes');

  return { pathPrefixes };
}

/**
 * Секция `integrity`: правила путей для контроля целостности проверок (#27).
 * @param {unknown} value
 * @returns {IntegrityRules}
 */
function parseIntegrity(value) {
  if (!isRecord(value)) {
    throw new ConfigError(`${label()}: integrity — ожидается объект`);
  }
  assertKnownFields(value, 'integrity', SECTION_FIELDS.integrity);

  return {
    testPaths:
      value.testPaths === undefined
        ? [...DEFAULTS.integrity.testPaths]
        : pathPatterns(value.testPaths, 'integrity.testPaths'),
    protectedPaths:
      value.protectedPaths === undefined
        ? [...DEFAULTS.integrity.protectedPaths]
        : pathPatterns(value.protectedPaths, 'integrity.protectedPaths'),
  };
}

/**
 * Список правил путей: массив относительных путей без `..` и пустых сегментов.
 * @param {unknown} value
 * @param {string} path
 * @returns {string[]}
 */
function pathPatterns(value, path) {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${label()}: ${path} — ожидается массив строк`);
  }
  return value.map((item, index) => patternField(item, `${path}[${index}]`));
}

/**
 * Правило пути: непустая относительная строка. Завершающий `/` срезается (каталог и
 * `каталог/` — одно правило), `..`, `.` и пустые сегменты запрещены: правило не должно
 * уводить сопоставление за пределы репозитория и не должно зависеть от формы записи.
 * @param {unknown} value
 * @param {string} path
 * @returns {string}
 */
function patternField(value, path) {
  const raw = stringField(value, path);
  const rule = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const segments = rule.split('/');
  const relative = !rule.startsWith('/') && !rule.includes('\\');
  const clean = segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  if (!relative || !clean) {
    throw new ConfigError(
      `${label()}: ${path} — ожидается относительный путь без «..» и пустых сегментов`,
    );
  }
  return rule;
}

/**
 * Секция `evals`: пути к снапшотам и сидам.
 * @param {unknown} value
 * @returns {EvalsPaths}
 */
function parseEvals(value) {
  if (!isRecord(value)) {
    throw new ConfigError(`${label()}: evals — ожидается объект`);
  }
  assertKnownFields(value, 'evals', SECTION_FIELDS.evals);

  /** @type {EvalsPaths} */
  const evals = { ...DEFAULTS.evals };
  for (const [key, raw] of Object.entries(value)) {
    // Ключ уже проверен `assertKnownFields` по `SECTION_FIELDS.evals`, то есть по схеме.
    evals[/** @type {keyof EvalsPaths} */ (key)] = stringField(raw, `evals.${key}`);
  }
  return evals;
}

/**
 * Подполя `env` у гейта: список полон, `inherit`/`except` и прочие догадки — ошибка (ADR 0007, г).
 */
const GATE_ENV_FIELDS = Object.freeze(['allow', 'set']);

/**
 * Объявленное окружение гейта (ADR 0007, б). Пустой объект — валидное объявление: гейт получает
 * только служебные переменные. `env` у `builtin` — ошибка: встроенная проверка идёт в процессе
 * ядра и окружения не получает (ADR 0007, г).
 * @param {unknown} value
 * @param {string} path путь гейта для сообщения (`gates[<n>]`)
 * @param {string|null} builtin встроенная проверка (если задана — `env` запрещён)
 * @returns {GateEnv}
 */
function parseGateEnv(value, path, builtin) {
  if (builtin !== null) {
    throw new ConfigError(`${label()}: ${path}.env — builtin-гейт окружения не получает`);
  }
  if (!isRecord(value)) {
    throw new ConfigError(`${label()}: ${path}.env — ожидается объект`);
  }
  for (const key of Object.keys(value)) {
    if (!GATE_ENV_FIELDS.includes(key)) {
      throw new ConfigError(`${label()}: ${path}.env — неизвестное поле env.${key}`);
    }
  }

  /** @type {string[]} */
  const allow = [];
  if (value.allow !== undefined) {
    if (!Array.isArray(value.allow)) {
      throw new ConfigError(`${label()}: ${path}.env.allow — ожидается массив имён`);
    }
    for (const [index, name] of value.allow.entries()) {
      const where = `${path}.env.allow[${index}]`;
      if (!isText(name)) {
        throw new ConfigError(`${label()}: ${where} — ожидается непустое имя переменной`);
      }
      const trimmed = name.trim();
      if (allow.includes(trimmed)) {
        throw new ConfigError(`${label()}: ${where} — дубль ${JSON.stringify(trimmed)}`);
      }
      allow.push(trimmed);
    }
  }

  /** @type {Record<string, string>} */
  const set = {};
  if (value.set !== undefined) {
    if (!isRecord(value.set)) {
      throw new ConfigError(`${label()}: ${path}.env.set — ожидается объект`);
    }
    for (const [name, literal] of Object.entries(value.set)) {
      // Пустое имя переменной окружения не работает: `PATH=` задаётся именем, а не пустотой.
      if (!isText(name)) {
        throw new ConfigError(`${label()}: ${path}.env.set — пустое имя переменной`);
      }
      if (typeof literal !== 'string') {
        throw new ConfigError(
          `${label()}: ${path}.env.set.${name} — ожидается строка (значения — литералы, не числа)`,
        );
      }
      set[name] = literal;
    }
  }

  return { allow, set };
}

/**
 * Нормализует гейт: старый `cmd` разбирается по пробелам с предупреждением, новый формат —
 * `executable` + `args`. Выходная форма всегда содержит `cmd` для совместимости с
 * `gates.<n>.json` (`null` — встроенная проверка).
 * @param {unknown} value
 * @param {number} index
 * @param {Set<string>} ids
 * @returns {{
 *   id: string,
 *   executable: string|null,
 *   args: string[],
 *   cmd: string|null,
 *   builtin: string|null,
 *   required: boolean,
 *   dependsOn: string[],
 *   pathPrefixes: string[],
 *   dbGate: boolean,
 *   env: GateEnv|null,
 * }}
 */
function parseGate(value, index, ids) {
  const path = `gates[${index}]`;
  if (!isRecord(value)) {
    throw new ConfigError(`${label()}: ${path} — ожидается объект`);
  }
  assertKnownFields(value, path, GATE_FIELDS);

  const id = value.id;
  if (!isText(id)) {
    throw new ConfigError(`${label()}: ${path}.id — пустой идентификатор`);
  }
  if (ids.has(id)) {
    throw new ConfigError(`${label()}: ${path}.id — дубль ${JSON.stringify(id)}`);
  }
  ids.add(id);

  const builtin = value.builtin ?? null;
  if (builtin !== null && (typeof builtin !== 'string' || !BUILTIN_GATES.includes(builtin))) {
    throw new ConfigError(
      `${label()}: ${path}.builtin — неизвестная встроенная проверка ${JSON.stringify(builtin)}`,
    );
  }

  /** @type {string|null} */
  let executable = null;
  /** @type {string[]} */
  let args = [];
  /** @type {string|null} */
  let cmd = null;

  if (builtin !== null) {
    if (value.executable !== undefined || value.args !== undefined || value.cmd !== undefined) {
      throw new ConfigError(`${label()}: ${path} — builtin не сочетается с executable/args/cmd`);
    }
  } else if (value.cmd !== undefined) {
    if (value.executable !== undefined || value.args !== undefined) {
      throw new ConfigError(`${label()}: ${path} — задайте либо cmd, либо executable+args`);
    }
    const legacy = stringField(value.cmd, `${path}.cmd`);
    const parts = legacy.split(/\s+/u).filter((part) => part !== '');
    if (parts.length === 0) {
      throw new ConfigError(`${label()}: ${path}.cmd — пустая команда`);
    }
    const [head, ...tail] = parts;
    if (head === undefined) {
      throw new ConfigError(`${label()}: ${path}.cmd — пустая команда`);
    }
    executable = head;
    args = tail;
    cmd = legacy;
    warnLegacy(path, id);
  } else {
    executable = stringField(value.executable, `${path}.executable`);
    if (value.args !== undefined) {
      if (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== 'string')) {
        throw new ConfigError(`${label()}: ${path}.args — ожидается массив строк`);
      }
      args = [...value.args];
    }
    cmd = [executable, ...args].join(' ');
  }

  // Явный `null` — ошибка типа, а не повод подставить дефолт: `??` пропустил бы его молча.
  const required = value.required === undefined ? true : value.required;
  if (typeof required !== 'boolean') {
    throw new ConfigError(`${label()}: ${path}.required — ожидается boolean`);
  }

  const dependsOn = stringList(value.dependsOn, `${path}.dependsOn`);
  const pathPrefixes = stringList(value.pathPrefixes, `${path}.pathPrefixes`);

  const dbGate = value.dbGate === undefined ? false : value.dbGate;
  if (typeof dbGate !== 'boolean') {
    throw new ConfigError(`${label()}: ${path}.dbGate — ожидается boolean`);
  }

  const gateEnv = value.env === undefined ? null : parseGateEnv(value.env, path, builtin);

  return {
    id,
    executable,
    args,
    cmd,
    builtin,
    required,
    dependsOn,
    pathPrefixes,
    dbGate,
    env: gateEnv,
  };
}

/**
 * Массив непустых строк; отсутствие — пустой массив.
 * @param {unknown} value
 * @param {string} path
 * @returns {string[]}
 */
function stringList(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw new ConfigError(`${label()}: ${path} — ожидается массив непустых строк`);
  }
  return [...value];
}

/**
 * Предупреждение о старом формате `cmd`; повторные вызовы не дублируют строку.
 * @param {string} path
 * @param {string} id
 * @returns {void}
 */
function warnLegacy(path, id) {
  const key = `${path}:${id}`;
  if (warned.has(key)) return;
  warned.add(key);
  process.stderr.write(
    `config: ${path} (${id}) использует устаревший cmd; задайте executable+args\n`,
  );
}

/**
 * Секция `gates`: порядок массива — порядок выполнения, дубли и неизвестные зависимости
 * запрещены.
 * @param {unknown} value
 * @returns {ReadonlyArray<LoadedGate>}
 */
function parseGates(value) {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${label()}: gates — ожидается массив`);
  }
  const ids = new Set();
  const gates = value.map((gate, index) => parseGate(gate, index, ids));

  for (const gate of gates) {
    for (const parent of gate.dependsOn) {
      if (!ids.has(parent)) {
        throw new ConfigError(
          `${label()}: gates (${gate.id}).dependsOn — неизвестный гейт ${parent}`,
        );
      }
    }
  }
  return deepFreeze(gates);
}

/**
 * Секция `gateTimeouts`: положительное целое число миллисекунд для известного гейта.
 * @param {unknown} value
 * @param {Set<string>} gateIds
 * @returns {Record<string, number>}
 */
function parseGateTimeouts(value, gateIds) {
  if (!isRecord(value)) {
    throw new ConfigError(`${label()}: gateTimeouts — ожидается объект`);
  }
  /** @type {Record<string, number>} */
  const timeouts = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!gateIds.has(id)) {
      throw new ConfigError(
        `${label()}: gateTimeouts.${id} — неизвестный гейт (сначала объявите его в gates)`,
      );
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
      throw new ConfigError(`${label()}: gateTimeouts.${id} — ожидается целое число мс > 0`);
    }
    timeouts[id] = raw;
  }
  return timeouts;
}

/**
 * Загружает конфигурацию проекта. Отсутствующий файл даёт `DEFAULTS`; частичные секции
 * дополняются дефолтами. Результат заморожен.
 * @param {string} root корень проекта
 * @param {{ file?: string|null, allowMissing?: boolean }} [options] `file` — путь конфига из
 *   `--config`/`HARNESS_CONFIG` (`null` — умолчание); относительный путь считается от `root`,
 *   как и все остальные пути ядра. `allowMissing` — вызывающий сам создаёт файл по этому пути
 *   (`harness-init` ставит пример конфига): отсутствие тогда даёт дефолты, а не ошибку
 * @returns {Readonly<{
 *   gates: ReadonlyArray<LoadedGate>,
 *   limits: Limits,
 *   limitsExplicit: readonly string[],
 *   paths: Paths,
 *   evals: EvalsPaths,
 *   qaWeb: { pathPrefixes: readonly string[] },
 *   integrity: IntegrityRules,
 *   provider: string,
 *   gateTimeouts: Record<string, number>,
 *   configFile: string,
 *   configPath: string,
 * }>}
 *   `configFile` — метка фактического пути конфига для сообщений (относительно корня или
 *   абсолютная, если конфиг вне дерева), `configPath` — абсолютный путь.
 */
export function loadConfig(root, { file = null, allowMissing = false } = {}) {
  const resolved = resolveConfigPath(root, file);
  const previous = activeLabel;
  activeLabel = resolved.label;
  try {
    const doc = readConfigFile(resolved.file, file !== null, allowMissing);
    const positions = { configFile: resolved.label, configPath: resolved.file };
    // Файла нет: все лимиты — дефолты ядра, явно заданных ключей нет.
    if (doc === null) return deepFreeze({ ...DEFAULTS, limitsExplicit: [], ...positions });
    if (!isRecord(doc)) {
      throw new ConfigError(`${label()}: ожидается объект`);
    }

    for (const key of Object.keys(doc)) {
      if (!SECTIONS.includes(key)) {
        throw new ConfigError(`${label()}: неизвестная секция ${key}`);
      }
    }

    const gates = doc.gates === undefined ? DEFAULTS.gates : parseGates(doc.gates);
    const gateIds = new Set(gates.map((gate) => gate.id));
    const provider =
      doc.provider === undefined ? DEFAULTS.provider : stringField(doc.provider, 'provider');
    if (!provider.endsWith('/')) {
      throw new ConfigError(`${label()}: provider — ожидается префикс с «/» на конце`);
    }

    const parsedLimits =
      doc.limits === undefined
        ? { limits: DEFAULTS.limits, explicit: /** @type {readonly string[]} */ ([]) }
        : parseLimits(doc.limits);

    return deepFreeze({
      gates,
      limits: parsedLimits.limits,
      limitsExplicit: parsedLimits.explicit,
      paths: doc.paths === undefined ? DEFAULTS.paths : parsePaths(doc.paths),
      evals: doc.evals === undefined ? DEFAULTS.evals : parseEvals(doc.evals),
      qaWeb: doc.qaWeb === undefined ? DEFAULTS.qaWeb : parseQaWeb(doc.qaWeb),
      integrity: doc.integrity === undefined ? DEFAULTS.integrity : parseIntegrity(doc.integrity),
      provider,
      gateTimeouts:
        doc.gateTimeouts === undefined
          ? DEFAULTS.gateTimeouts
          : parseGateTimeouts(doc.gateTimeouts, gateIds),
      ...positions,
    });
  } finally {
    activeLabel = previous;
  }
}
