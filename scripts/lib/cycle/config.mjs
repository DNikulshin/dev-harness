/**
 * Конфигурация проекта для ядра цикла.
 *
 * Ядро не знает конкретный проект: гейты, лимиты, пути и провайдер моделей приходят из
 * `<root>/.pi/harness.config.json`. Здесь только загрузчик и нейтральные значения по
 * умолчанию. Гейтов в дефолтах нет: проект без секции `gates` — валидное состояние,
 * `cycle-gates` сообщает «гейты не заданы» и завершается кодом 2.
 *
 * Ошибки конфига — `ConfigError` с `code = 2`: неизвестная секция или поле, неверный тип,
 * отрицательное число, пустой `id`, дубли `id`, отсутствующий `executable` не превращаются
 * в молчаливый дефолт. Тексты ошибок не содержат содержимого файлов, поэтому `.env*` и
 * другие секреты в диагностику не попадают.
 *
 * Обратная совместимость: гейт со строковым `cmd` (старый формат) разбирается по пробелам,
 * о чём печатается предупреждение в stderr. Новый формат — `executable` + `args`, без
 * оболочки: аргументы не интерполируются.
 *
 * Shebang не нужен: модуль подключается из CLI-скриптов `cycle-*.mjs` и `evals-*.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Имя файла конфигурации относительно корня проекта. */
export const CONFIG_FILE = Object.freeze({ dir: '.pi', name: 'harness.config.json' });

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
  evals: {
    prices: 'evals/prices.json',
    profiles: 'evals/profiles.json',
    candidates: 'evals/candidates.json',
    seedsDir: 'evals/orchestrator/seeds',
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
 */

/** Допустимые секции конфига: всё остальное — ошибка, а не игнор. */
const SECTIONS = Object.freeze(['gates', 'limits', 'paths', 'evals', 'provider', 'gateTimeouts']);

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
]);

/** Уже напечатанные предупреждения: один и тот же конфиг не спамит при каждом вызове. */
const warned = new Set();

/**
 * Ошибка конфигурации. Код 2 совпадает с кодом выхода CLI: ошибка использования, а не
 * падение инструмента.
 */
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
 * Плоский объект: массивы и `null` объектами не считаются.
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Непустая строка.
 * @param {unknown} value
 * @returns {boolean}
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
 * Читает JSON конфига. Отсутствие файла — не ошибка: работают дефолты.
 * @param {string} file
 * @returns {unknown}
 */
function readConfigFile(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new ConfigError(evalLabel('битый JSON'));
  }
}

/**
 * Метка файла для диагностики: относительный путь `.pi/harness.config.json`, без
 * содержимого и без абсолютного пути дерева.
 * @param {string} reason
 * @returns {string}
 */
function evalLabel(reason) {
  return `.pi/harness.config.json: ${reason}`;
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
      throw new ConfigError(`.pi/harness.config.json: неизвестное поле ${name}.${key}`);
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
    throw new ConfigError(`.pi/harness.config.json: ${path} — ожидается число`);
  }
  if (value < 0 || (positive && value === 0)) {
    throw new ConfigError(`.pi/harness.config.json: ${path} — ожидается положительное число`);
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
    throw new ConfigError(`.pi/harness.config.json: ${path} — ожидается непустая строка`);
  }
  return value;
}

/**
 * Секция `limits`: каждое поле — положительное число, лишние поля запрещены.
 * @param {unknown} value
 * @returns {Record<string, number>}
 */
function parseLimits(value) {
  if (!isRecord(value)) {
    throw new ConfigError('.pi/harness.config.json: limits — ожидается объект');
  }
  assertKnownFields(value, 'limits', SECTION_FIELDS.limits);

  /** @type {Record<string, number>} */
  const limits = { ...DEFAULTS.limits };
  for (const [key, raw] of Object.entries(value)) {
    limits[key] = numberField(raw, `limits.${key}`);
  }
  return limits;
}

/**
 * Секция `paths`: строки, `prTemplate` может быть пустой (шаблон не задан).
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function parsePaths(value) {
  if (!isRecord(value)) {
    throw new ConfigError('.pi/harness.config.json: paths — ожидается объект');
  }
  assertKnownFields(value, 'paths', SECTION_FIELDS.paths);

  /** @type {Record<string, string>} */
  const paths = { ...DEFAULTS.paths };
  for (const [key, raw] of Object.entries(value)) {
    paths[key] = stringField(raw, `paths.${key}`, { allowEmpty: key === 'prTemplate' });
  }
  return paths;
}

/**
 * Секция `evals`: пути к снапшотам и сидам.
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function parseEvals(value) {
  if (!isRecord(value)) {
    throw new ConfigError('.pi/harness.config.json: evals — ожидается объект');
  }
  assertKnownFields(value, 'evals', SECTION_FIELDS.evals);

  /** @type {Record<string, string>} */
  const evals = { ...DEFAULTS.evals };
  for (const [key, raw] of Object.entries(value)) {
    evals[key] = stringField(raw, `evals.${key}`);
  }
  return evals;
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
 * }}
 */
function parseGate(value, index, ids) {
  const path = `gates[${index}]`;
  if (!isRecord(value)) {
    throw new ConfigError(`.pi/harness.config.json: ${path} — ожидается объект`);
  }
  assertKnownFields(value, path, GATE_FIELDS);

  const id = value.id;
  if (!isText(id)) {
    throw new ConfigError(`.pi/harness.config.json: ${path}.id — пустой идентификатор`);
  }
  if (ids.has(id)) {
    throw new ConfigError(`.pi/harness.config.json: ${path}.id — дубль ${JSON.stringify(id)}`);
  }
  ids.add(id);

  const builtin = value.builtin ?? null;
  if (builtin !== null && !BUILTIN_GATES.includes(builtin)) {
    throw new ConfigError(
      `.pi/harness.config.json: ${path}.builtin — неизвестная встроенная проверка ${JSON.stringify(builtin)}`,
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
      throw new ConfigError(
        `.pi/harness.config.json: ${path} — builtin не сочетается с executable/args/cmd`,
      );
    }
  } else if (value.cmd !== undefined) {
    if (value.executable !== undefined || value.args !== undefined) {
      throw new ConfigError(
        `.pi/harness.config.json: ${path} — задайте либо cmd, либо executable+args`,
      );
    }
    const legacy = stringField(value.cmd, `${path}.cmd`);
    const parts = legacy.split(/\s+/u).filter((part) => part !== '');
    if (parts.length === 0) {
      throw new ConfigError(`.pi/harness.config.json: ${path}.cmd — пустая команда`);
    }
    [executable, ...args] = parts;
    cmd = legacy;
    warnLegacy(path, id);
  } else {
    executable = stringField(value.executable, `${path}.executable`);
    if (value.args !== undefined) {
      if (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== 'string')) {
        throw new ConfigError(`.pi/harness.config.json: ${path}.args — ожидается массив строк`);
      }
      args = [...value.args];
    }
    cmd = [executable, ...args].join(' ');
  }

  const required = value.required ?? true;
  if (typeof required !== 'boolean') {
    throw new ConfigError(`.pi/harness.config.json: ${path}.required — ожидается boolean`);
  }

  const dependsOn = stringList(value.dependsOn, `${path}.dependsOn`);
  const pathPrefixes = stringList(value.pathPrefixes, `${path}.pathPrefixes`);

  return { id, executable, args, cmd, builtin, required, dependsOn, pathPrefixes };
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
    throw new ConfigError(`.pi/harness.config.json: ${path} — ожидается массив непустых строк`);
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
    throw new ConfigError('.pi/harness.config.json: gates — ожидается массив');
  }
  const ids = new Set();
  const gates = value.map((gate, index) => parseGate(gate, index, ids));

  for (const gate of gates) {
    for (const parent of gate.dependsOn) {
      if (!ids.has(parent)) {
        throw new ConfigError(
          `.pi/harness.config.json: gates (${gate.id}).dependsOn — неизвестный гейт ${parent}`,
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
    throw new ConfigError('.pi/harness.config.json: gateTimeouts — ожидается объект');
  }
  /** @type {Record<string, number>} */
  const timeouts = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!gateIds.has(id)) {
      throw new ConfigError(
        `.pi/harness.config.json: gateTimeouts.${id} — неизвестный гейт (сначала объявите его в gates)`,
      );
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
      throw new ConfigError(
        `.pi/harness.config.json: gateTimeouts.${id} — ожидается целое число мс > 0`,
      );
    }
    timeouts[id] = raw;
  }
  return timeouts;
}

/**
 * Загружает конфигурацию проекта. Отсутствующий файл даёт `DEFAULTS`; частичные секции
 * дополняются дефолтами. Результат заморожен.
 * @param {string} root корень проекта
 * @returns {{
 *   gates: ReadonlyArray<{
 *     id: string,
 *     executable: string|null,
 *     args: readonly string[],
 *     cmd: string|null,
 *     builtin: string|null,
 *     required: boolean,
 *     dependsOn: readonly string[],
 *     pathPrefixes: readonly string[],
 *   }>,
 *   limits: Readonly<typeof DEFAULTS.limits>,
 *   paths: Readonly<typeof DEFAULTS.paths>,
 *   evals: Readonly<typeof DEFAULTS.evals>,
 *   provider: string,
 *   gateTimeouts: Readonly<Record<string, number>>,
 * }}
 */
export function loadConfig(root) {
  const file = join(root, CONFIG_FILE.dir, CONFIG_FILE.name);
  const doc = readConfigFile(file);
  if (doc === null) return DEFAULTS;
  if (!isRecord(doc)) {
    throw new ConfigError('.pi/harness.config.json: ожидается объект');
  }

  for (const key of Object.keys(doc)) {
    if (!SECTIONS.includes(key)) {
      throw new ConfigError(`.pi/harness.config.json: неизвестная секция ${key}`);
    }
  }

  const gates = doc.gates === undefined ? DEFAULTS.gates : parseGates(doc.gates);
  const gateIds = new Set(gates.map((gate) => gate.id));
  const provider =
    doc.provider === undefined ? DEFAULTS.provider : stringField(doc.provider, 'provider');
  if (!provider.endsWith('/')) {
    throw new ConfigError('.pi/harness.config.json: provider — ожидается префикс с «/» на конце');
  }

  return deepFreeze({
    gates,
    limits: doc.limits === undefined ? DEFAULTS.limits : parseLimits(doc.limits),
    paths: doc.paths === undefined ? DEFAULTS.paths : parsePaths(doc.paths),
    evals: doc.evals === undefined ? DEFAULTS.evals : parseEvals(doc.evals),
    provider,
    gateTimeouts:
      doc.gateTimeouts === undefined
        ? DEFAULTS.gateTimeouts
        : parseGateTimeouts(doc.gateTimeouts, gateIds),
  });
}
