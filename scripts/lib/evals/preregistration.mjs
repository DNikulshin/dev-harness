/**
 * Пред-регистрация замеров: машиночитаемый блок `evals/preregistration.md`
 * (`docs/evals.md`, `docs/orchestrator.md` §15).
 *
 * Зачем отдельный модуль, а не разбор в тесте: протокол — единственное место, где сказано,
 * какими порогами проверяется цифра замера, и проверяться он должен так же строго, как код.
 * Документ без проверки дрейфует молча: порог можно поменять в коде и не заметить, что
 * протокол остался обещать другое.
 *
 * Схема блока проверяется вручную, без зависимостей (как `lib/evals/seeds.mjs`): `{ ok, errors }`
 * и никаких исключений на битом документе — вызывающий решает, печатать ошибку или падать.
 * Отсутствие блока, битый JSON и неизвестные поля — ошибка: протокол без чисел бесполезен, а
 * «пусть будет дефолт» скрыло бы, что пред-регистрации нет.
 *
 * Shebang не нужен: модуль подключается из теста и, при необходимости, из CLI.
 */
import { readFileSync } from 'node:fs';

import { seedOrder } from './seeds.mjs';

/** Путь протокола относительно корня репозитория. */
export const PREREGISTRATION_PATH = 'evals/preregistration.md';

/** Единственные допустимые ключи блока: протокол не должен обрастать «на всякий случай». */
const FIELDS = Object.freeze(['version', 'since', 'min_repeats', 'thresholds', 'seeds']);

/** Ключи порогов: те же величины, что считает `evals-score`. */
const THRESHOLD_FIELDS = Object.freeze(['completeness', 'false_positive_max', 'line_tolerance']);

/** Минимум повторов из §15: меньше — это наблюдение, а не измерение. */
export const MIN_REPEATS = 3;

/** Блок `json` из markdown: протокол держит числа в одном блоке, а не в прозе. */
const JSON_BLOCK = /```json[ \t]*\r?\n([\s\S]*?)```/u;

/** Идентификатор сида: `E` + номер, как в таблице §15. */
const SEED_ID_PATTERN = /^E[1-9]\d*$/u;

/**
 * @typedef {object} Preregistration
 * @property {number} version версия протокола, целое ≥ 1
 * @property {string} since дата начала действия, `YYYY-MM-DD`
 * @property {number} min_repeats минимум повторов на ячейку «сид + стадия»
 * @property {{ completeness: number, false_positive_max: number, line_tolerance: number }} thresholds
 * @property {string[]} seeds id сидов набора
 */

/**
 * Плоский объект: массивы и `null` объектами не считаются.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>} сужает тип вызывающего кода
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Число в допустимом диапазоне.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {value is number}
 */
function isNumberIn(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Достаёт единственный `json`-блок из markdown протокола.
 * @param {unknown} markdown
 * @returns {{ text: string|null, errors: string[] }} `text` — содержимое блока без ограждения
 */
export function extractPreregistrationBlock(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return { text: null, errors: ['протокол: пустой документ'] };
  }
  const blocks = [...markdown.matchAll(new RegExp(JSON_BLOCK.source, 'gu'))];
  if (blocks.length === 0) {
    return {
      text: null,
      errors: ['протокол: нет блока ```json с порогами и набором сидов'],
    };
  }
  if (blocks.length > 1) {
    return {
      text: null,
      errors: ['протокол: блоков ```json больше одного — какой из них протокол?'],
    };
  }
  return { text: (blocks[0]?.[1] ?? '').trim(), errors: [] };
}

/**
 * Разбирает блок и проверяет схему протокола.
 * @param {unknown} block содержимое блока (уже без ограждения)
 * @returns {{ ok: boolean, errors: string[], prereg: Preregistration|null }}
 */
export function readPreregistration(block) {
  if (typeof block === 'string') {
    try {
      return readPreregistration(JSON.parse(block));
    } catch {
      return { ok: false, errors: ['протокол: блок ```json не разбирается'], prereg: null };
    }
  }

  if (!isRecord(block)) return { ok: false, errors: ['протокол: ожидается объект'], prereg: null };

  /** @type {string[]} */
  const errors = [];

  const unknown = Object.keys(block).filter((key) => !FIELDS.includes(key));
  if (unknown.length > 0) errors.push(`протокол: неизвестные поля ${unknown.join(', ')}`);
  const missing = FIELDS.filter((key) => block[key] === undefined);
  if (missing.length > 0) errors.push(`протокол: нет полей ${missing.join(', ')}`);

  const version = block.version;
  if (
    version !== undefined &&
    (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
  ) {
    errors.push('version: ожидается целое ≥ 1');
  }
  if (block.since !== undefined) {
    const since = typeof block.since === 'string' ? block.since : '';
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(since) || Number.isNaN(Date.parse(since))) {
      errors.push('since: ожидается дата YYYY-MM-DD');
    }
  }
  const minRepeats = block.min_repeats;
  if (minRepeats !== undefined) {
    if (
      typeof minRepeats !== 'number' ||
      !Number.isInteger(minRepeats) ||
      minRepeats < MIN_REPEATS
    ) {
      errors.push(`min_repeats: ожидается целое ≥ ${MIN_REPEATS} (§15)`);
    }
  }

  const rawThresholds = block.thresholds;
  if (!isRecord(rawThresholds)) {
    errors.push('thresholds: ожидается объект');
  } else {
    const extra = Object.keys(rawThresholds).filter((key) => !THRESHOLD_FIELDS.includes(key));
    if (extra.length > 0) errors.push(`thresholds: неизвестные поля ${extra.join(', ')}`);
    // Доли — от 0 до 1, допуск строки — не меньше 0: это не «настройка вкуса», а диапазон.
    if (!isNumberIn(rawThresholds.completeness, 0, 1)) {
      errors.push('thresholds.completeness: ожидается число от 0 до 1');
    }
    if (!isNumberIn(rawThresholds.false_positive_max, 0, 1)) {
      errors.push('thresholds.false_positive_max: ожидается число от 0 до 1');
    }
    if (!isNumberIn(rawThresholds.line_tolerance, 0, Number.MAX_SAFE_INTEGER)) {
      errors.push('thresholds.line_tolerance: ожидается число ≥ 0');
    }
  }

  /** @type {string[]} */
  const seeds = [];
  if (!Array.isArray(block.seeds)) {
    errors.push('seeds: ожидается массив id');
  } else if (block.seeds.length === 0) {
    errors.push('seeds: пустой набор — протокол без сидов ничего не проверяет');
  } else {
    /** @type {Set<string>} */
    const seen = new Set();
    block.seeds.forEach((item, index) => {
      const id = typeof item === 'string' ? item : '';
      if (!SEED_ID_PATTERN.test(id)) {
        errors.push(`seeds[${index}]: ожидается id вида E<номер>`);
        return;
      }
      if (seen.has(id)) {
        errors.push(`seeds[${index}]: сид ${id} уже объявлен`);
        return;
      }
      seen.add(id);
      seeds.push(id);
    });
  }

  if (errors.length > 0) return { ok: false, errors, prereg: null };

  const thresholds =
    /** @type {{ completeness: number, false_positive_max: number, line_tolerance: number }} */ (
      block.thresholds
    );

  return {
    ok: true,
    errors,
    prereg: {
      version: /** @type {number} */ (version),
      since: /** @type {string} */ (block.since),
      min_repeats: /** @type {number} */ (minRepeats),
      thresholds: {
        completeness: thresholds.completeness,
        false_positive_max: thresholds.false_positive_max,
        line_tolerance: thresholds.line_tolerance,
      },
      seeds: seeds.sort((left, right) => seedOrder(left) - seedOrder(right)),
    },
  };
}

/**
 * Читает протокол из файла: ограждение, JSON и схема — с одним сообщением на все ошибки.
 * @param {string} file абсолютный путь к `preregistration.md`
 * @returns {Preregistration}
 */
export function loadPreregistration(file) {
  const block = extractPreregistrationBlock(readFileSync(file, 'utf8'));
  if (block.text === null) throw new Error(block.errors.join('\n'));

  const result = readPreregistration(block.text);
  if (result.prereg === null) {
    throw new Error(`пред-регистрация нарушена:\n${result.errors.join('\n')}`);
  }
  return result.prereg;
}
