/**
 * Маскирование ПДн и секретов (docs/orchestrator-core.md §5.4) и детектор гейта
 * `secrets_scan` (§5.5).
 *
 * Замены строго по таблице §5.4: строки не удаляются и не склеиваются (переводы строк
 * в шаблоны не входят), поэтому нумерация строк в диффе и логах не меняется.
 * Shebang не нужен: модуль подключается из CLI-скриптов `cycle-*.mjs`.
 */

/**
 * Горизонтальный пробел. `\s` включал бы `\n`, и значение «через строку» склеило бы
 * соседние строки лога — номера строк в диффе поехали бы.
 */
const H = '[^\\S\\n]';

/** Значение заголовка авторизации: ключ сохраняется, значение заменяется на `[secret]`. */
const AUTH_HEADER = new RegExp(
  `(?<![A-Za-z0-9-])(authorization|set-cookie|cookie)(["']?${H}*[:=]${H}*["']?)(?:Bearer|Basic)?${H}*[^\\s"',;]+`,
  'gi',
);

/** JWT: три сегмента base64url, первый начинается с `eyJ`. */
const JWT = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** Строка подключения с паролем: `postgres(ql)://user:pass@` → `postgresql://[secret]@`. */
const PG_URL = /\bpostgres(?:ql)?:\/\/[^\s:/@]+:([^\s@/]+)@/gi;

/** Присвоение секрета: значение от 8 символов после `=` или `:`. */
const SECRET_ASSIGNMENT = new RegExp(
  `(?<![A-Za-z0-9])(key|token|secret|password|passwd|pwd)(["']?${H}*[:=]${H}*["']?)([^\\s"',;]{8,})`,
  'gi',
);

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Общий международный формат: `+79990000000`, `+7 (999) 000-00-00`, `+1 555 0100`.
 * Совпадение принимается только при ≥ 7 цифрах (см. `maskPhone`), чтобы часовой пояс
 * `+03:00` в ISO-времени не превратился в `[phone]`.
 */
const PHONE_INTL = /\+[\d(][\d \t()-]*\d/g;

/** Минимум цифр в телефоне: короче — это не телефон, а смещение или число. */
const MIN_PHONE_DIGITS = 7;

/** Российский местный формат: `89990000000`, `8 (999) 000-00-00`. */
const PHONE_LOCAL = /(?<![\d+])8[ \t(-]?\(?\d{3}\)?[ \t-]?\d{3}[ \t-]?\d{2}[ \t-]?\d{2}(?!\d)/g;

/** PEM-заголовок приватного ключа (§5.5). */
const PRIVATE_KEY_HEADER = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/;

const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/;

const JWT_DETECT = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

/** Присвоение секрета: строковый литерал или «голое» значение от 12 символов (§5.5). */
const ASSIGNED_SECRET = new RegExp(
  '(?:api[-_]?key|secret|token|password|passwd|pass|pwd|credential)' +
    `["']?${H}*[:=]${H}*(?:"([^"]{12,})"|'([^']{12,})'|([^\\s"',;#]{12,}))`,
  'gi',
);

/**
 * Префиксные токены провайдеров (§5.5): префикс фиксирован, тело — алфавит и минимальная
 * длина. Длины выбраны так, чтобы соседние идентификаторы не задевались: `npm_config_cache`
 * не токен (после `npm_` идёт `_`), а `sk_live_…`/`ghp_…` без присваивания — токен.
 */
const PROVIDER_TOKENS = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  /\bnpm_[A-Za-z0-9]{30,}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
];

/**
 * Строка подключения с паролем для любой известной схемы (§5.5). `postgres` входит сюда же:
 * отдельного вида находки для него больше нет, вид один — `password_url`.
 */
const PASSWORD_URL =
  /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|rediss?|mysql|amqps?):\/\/[^\s:/@]+:([^\s@/]+)@/gi;

/** Значение заголовка авторизации (§5.5): `Bearer`/`Basic` + токен от 12 символов. */
const BEARER_TOKEN =
  /\b(?:proxy-)?authorization[ \t]*[:=][ \t]*(?:bearer|basic)[ \t]+([^\s"',;]{12,})/gi;

/**
 * Значение-ссылка на код (`process.env.TOKEN`, `config.apiKey`), а не литерал секрета:
 * секрет в дифф не попадает, поэтому и находки нет. Проверяется только «голое» значение —
 * значение в кавычках это уже литерал.
 */
const CODE_REFERENCE = /^(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*$/;

/**
 * Явные заглушки: похожи на секрет, но им не являются (§5.5). Проверка идёт по всему
 * значению, а не по подстроке: боевой секрет, внутри которого встречается `example`
 * (`prodexample12345678`), обязан давать находку. Суффикс через `-`/`_` допускается
 * только у слов-заглушек (`example-token-value`), чтобы образцы из документации
 * не считались секретами.
 */
const PLACEHOLDER = new RegExp(
  '^(?:(?:example|sample|changeme|change[-_]me|placeholder|dummy|fake|test|xxx+)(?:[-_].*)?' +
    '|your[-_].*|<.*>|\\{\\{.*\\}\\}|\\$\\{.*\\})$',
  'i',
);

/**
 * Заменяет значения после ключа, сохраняя сам ключ и разделитель.
 * @param {string} _match
 * @param {string} name
 * @param {string} separator
 * @returns {string}
 */
function keepKey(_match, name, separator) {
  return `${name}${separator}[secret]`;
}

/**
 * Маскирует телефон, только если цифр в нём достаточно для номера.
 * @param {string} match
 * @returns {string}
 */
function maskPhone(match) {
  const digits = match.match(/\d/g);
  return digits !== null && digits.length >= MIN_PHONE_DIGITS ? '[phone]' : match;
}

/**
 * Маскирует ПДн и секреты в тексте лога (§5.4).
 * @param {string} text одна строка или многострочный текст
 * @returns {string}
 */
export function redactLog(text) {
  if (typeof text !== 'string') throw new TypeError('redactLog: ожидается строка');

  // Порядок важен: секреты вычищаются раньше контактов, чтобы значение-секрет,
  // содержащее e-mail или телефон, не превратилось в `[email]`/`[phone]`.
  return text
    .replace(AUTH_HEADER, keepKey)
    .replace(JWT, '[secret]')
    .replace(PG_URL, 'postgresql://[secret]@')
    .replace(SECRET_ASSIGNMENT, keepKey)
    .replace(EMAIL, '[email]')
    .replace(PHONE_INTL, maskPhone)
    .replace(PHONE_LOCAL, '[phone]');
}

/**
 * Рекурсивно маскирует строковые значения, не меняя структуру: массивы, их длина и
 * `id` шагов QA остаются прежними (§5.4). Входной объект не мутируется — возвращается
 * новая структура той же формы.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function redactQa(value) {
  if (typeof value === 'string') return /** @type {T} */ (redactLog(value));
  if (Array.isArray(value)) return /** @type {T} */ (value.map((item) => redactQa(item)));
  if (typeof value === 'object' && value !== null) {
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = redactQa(item);
    return /** @type {T} */ (result);
  }
  return value;
}

/**
 * Является ли значение целиком явной заглушкой. Регистр и краевые пробелы не важны.
 * @param {string} value
 * @returns {boolean}
 */
function isPlaceholder(value) {
  const normalized = value.trim();
  return normalized === '' || PLACEHOLDER.test(normalized);
}

/**
 * Есть ли в строке URI с паролем (любая известная схема) и пароль не шаблонный.
 * @param {string} text
 * @returns {boolean}
 */
function hasPasswordUrl(text) {
  for (const match of text.matchAll(PASSWORD_URL)) {
    if (!isPlaceholder(match[1] ?? '')) return true;
  }
  return false;
}

/**
 * Есть ли префиксный токен провайдера, который не является заглушкой.
 * @param {string} text
 * @returns {boolean}
 */
function hasProviderToken(text) {
  for (const pattern of PROVIDER_TOKENS) {
    const match = pattern.exec(text);
    if (match !== null && !isPlaceholder(match[0])) return true;
  }
  return false;
}

/**
 * Есть ли заголовок авторизации с токеном. Значение-JWT не считается отдельной находкой:
 * вид `jwt` у той же строки уже есть, и два вида на один секрет — шум, а не сигнал.
 * @param {string} text
 * @returns {boolean}
 */
function hasBearerToken(text) {
  for (const match of text.matchAll(BEARER_TOKEN)) {
    const value = match[1] ?? '';
    if (isPlaceholder(value)) continue;
    if (JWT_DETECT.test(value)) continue;
    return true;
  }
  return false;
}

/**
 * Есть ли в строке присвоение секрета строковым литералом от 12 символов,
 * не являющееся заглушкой.
 * @param {string} text
 * @returns {boolean}
 */
function hasAssignedSecret(text) {
  for (const match of text.matchAll(ASSIGNED_SECRET)) {
    // Группы значения: 1 — двойные кавычки, 2 — одинарные, 3 — без кавычек. Имя ключа
    // в выражении не захватывается: оно не нужно, а захват сдвигал бы индексы.
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (isPlaceholder(value)) continue;
    // Голое значение может оказаться кодом — вызовом функции или ссылкой на поле конфига.
    // Это не утечка: литерала секрета в такой строке нет.
    if (
      match[3] !== undefined &&
      (value.includes('(') || value.includes(')') || CODE_REFERENCE.test(value))
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * @typedef {object} SecretFinding
 * @property {number} line номер элемента в `addedLines` (нумерация с 1)
 * @property {string} kind вид находки: `private_key`, `aws_access_key`, `jwt`,
 *   `provider_token`, `password_url`, `bearer_token`, `assigned_secret`
 */

/**
 * Детектор гейта `secrets_scan` (§5.5): ищет секреты только в добавленных строках диффа.
 * Значение секрета в результат не попадает — только номер строки и вид находки.
 * Имени файла здесь нет (`git.addedLinesByFile` отдаёт только текст), поэтому и исключений
 * по имени нет: `.env.example` сканируется наравне с остальными, а образцы отсекаются
 * по значению (`PLACEHOLDER`).
 * @param {unknown} addedLines добавленные строки диффа без префикса `+` (не массив — `TypeError`)
 * @returns {SecretFinding[]}
 */
export function scanSecrets(addedLines) {
  if (!Array.isArray(addedLines)) {
    throw new TypeError('scanSecrets: ожидается массив добавленных строк');
  }

  /** @type {SecretFinding[]} */
  const findings = [];

  addedLines.forEach((text, index) => {
    if (typeof text !== 'string') {
      throw new TypeError(`scanSecrets: строка ${index + 1} не является строкой`);
    }
    const line = index + 1;
    if (PRIVATE_KEY_HEADER.test(text)) findings.push({ line, kind: 'private_key' });
    if (AWS_ACCESS_KEY.test(text)) findings.push({ line, kind: 'aws_access_key' });
    if (JWT_DETECT.test(text)) findings.push({ line, kind: 'jwt' });
    if (hasProviderToken(text)) findings.push({ line, kind: 'provider_token' });
    if (hasPasswordUrl(text)) findings.push({ line, kind: 'password_url' });
    if (hasBearerToken(text)) findings.push({ line, kind: 'bearer_token' });
    if (hasAssignedSecret(text)) findings.push({ line, kind: 'assigned_secret' });
  });

  return findings;
}
