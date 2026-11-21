/**
 * Ссылки на issues в репозитории: сбор и исключения, общие для офлайн-снимка и сетевой проверки
 * (issue #147).
 *
 * Зачем отдельный модуль. Один и тот же вопрос — «какие номера issue упомянуты в `scripts/` и
 * `docs/`» — задают двое: unit-тест `scripts/dead-issue-refs.test.mjs` (держит снимок мёртвых
 * номеров без сети) и сетевая проверка `tooling/check-issue-refs.mjs` (находит новые). Два набора
 * исключений разошлись бы на первой правке: сеть начала бы краснеть на hex-цвете `#6b7280`, на
 * ссылке в чужой трекер `owner/repo#233` или на историческом документе в `docs/research/`, а
 * unit-тест в то же время молчал бы. Поэтому шаблон номера, области и исключения живут здесь, а
 * вызывающие решают только, что делать с найденным.
 *
 * Модуль читает файлы, но ничего не пишет: сбор ссылок — единственный побочный эффект.
 *
 * Shebang не нужен: модуль подключается тестом и `tooling/check-issue-refs.mjs`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Области, в которых номера проверяются: код ядра и норматив. Расширения разные, поэтому
 * проверка идёт по каталогу, а не по всему репозиторию: `evals/`, `templates/` и `tooling/`
 * намеренно вне области — там номера встречаются в примерах и фикстурах.
 * @type {readonly { dir: string, ext: string }[]}
 */
export const REF_SCOPES = Object.freeze([
  { dir: 'scripts', ext: '.mjs' },
  { dir: 'docs', ext: '.md' },
]);

/**
 * Каталоги внутри областей, где номера не проверяются: исторические документы и журнал переноса
 * ссылаются на чужой трекер и на номера, которых в этом репозитории нет (решение #129, п. «что не
 * входит»). Пути — от корня репозитория, с `/` как разделителем.
 * @type {readonly string[]}
 */
export const REF_EXCLUDES = Object.freeze(['docs/local', 'docs/research']);

/**
 * Голый номер issue: решётка и до пяти цифр (пример — `#N`), но не `owner/repo#N` и не часть
 * hex-литерала. Три исключения записаны в самом шаблоне:
 *
 * - `#6b7280` не даёт границы слова после цифр (дальше буква цвета);
 * - последовательность из шести и более цифр (`#111827`, `#374151`) — это цвет из палитры отчёта,
 *   а не номер: ссылок с шестизначными номерами в этом репозитории не бывает, а вот цветов —
 *   сколько угодно, и без потолка каждый из них краснел бы как мёртвый номер;
 * - адрес чужого трекера (`owner/repo#233`) отсекается запретом на `/` перед решёткой.
 * @type {RegExp}
 */
const BARE_REF = /(?<![\w/])#(\d{1,5})\b/gu;

/**
 * Номера, упомянутые в тексте: в порядке появления, без повторов.
 * @param {string} text
 * @returns {number[]}
 */
export function refsInText(text) {
  /** @type {number[]} */
  const numbers = [];
  for (const match of text.matchAll(BARE_REF)) {
    const ref = Number(match[1]);
    if (!Number.isInteger(ref) || ref <= 0) continue;
    if (!numbers.includes(ref)) numbers.push(ref);
  }
  return numbers;
}

/**
 * Файлы области под каталогом, рекурсивно, с учётом исключений. Каталоги внутри исключений не
 * читаются вовсе: исторические документы бывают большими, а их номера не имеют значения.
 * @param {string} root корень репозитория
 * @param {string} dir каталог области (имя относительно корня)
 * @param {string} ext
 * @param {Set<string>} excludes
 * @param {string[]} acc относительные posix-пути
 * @returns {string[]}
 */
function walk(root, dir, ext, excludes, acc) {
  for (const entry of readdirSync(join(root, dir)).sort()) {
    const path = `${dir}/${entry}`;
    if (excludes.has(path)) continue;
    if (statSync(join(root, path)).isDirectory()) {
      walk(root, path, ext, excludes, acc);
      continue;
    }
    if (entry.endsWith(ext)) acc.push(path);
  }
  return acc;
}

/**
 * Файлы, в которых ищутся ссылки: относительные posix-пути, отсортированные. Область может
 * отсутствовать в рабочей копии (например, каталог ещё не создан) — это не ошибка.
 * @param {string} root корень репозитория
 * @param {{ scopes?: readonly { dir: string, ext: string }[], excludes?: readonly string[] }} [options]
 * @returns {string[]}
 */
export function refFiles(root, options = {}) {
  const scopes = options.scopes ?? REF_SCOPES;
  const excludes = new Set(options.excludes ?? REF_EXCLUDES);
  /** @type {string[]} */
  const paths = [];

  for (const { dir, ext } of scopes) {
    let entries;
    try {
      entries = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    walk(root, dir, ext, excludes, paths);
  }
  return paths.sort();
}

/**
 * Все упоминания номеров issue в области: по одному элементу на вхождение, в порядке файлов и
 * строк. Повторы одного номера в разных строках остаются разными элементами — адрес нарушения
 * нужен точный.
 * @param {string} root корень репозитория
 * @param {{ scopes?: readonly { dir: string, ext: string }[], excludes?: readonly string[] }} [options]
 * @returns {{ ref: number, file: string, line: number }[]}
 */
export function collectRefs(root, options = {}) {
  /** @type {{ ref: number, file: string, line: number }[]} */
  const occurrences = [];

  for (const file of refFiles(root, options)) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(BARE_REF)) {
        const ref = Number(match[1]);
        if (!Number.isInteger(ref) || ref <= 0) continue;
        occurrences.push({ ref, file, line: index + 1 });
      }
    }
  }
  return occurrences;
}

/**
 * Уникальные номера из собранных вхождений, по возрастанию: резолвить один номер дважды незачем.
 * @param {{ ref: number }[]} occurrences
 * @returns {number[]}
 */
export function refNumbers(occurrences) {
  return [...new Set(occurrences.map(({ ref }) => ref))].sort((left, right) => left - right);
}

/**
 * Вхождения, номера которых помечены мёртвыми. Возвращает адреса, а не номера: сообщение должно
 * показывать `файл:строка`, иначе искать нарушение вручную.
 * @param {{ ref: number, file: string, line: number }[]} occurrences
 * @param {ReadonlySet<number>} dead
 * @returns {{ ref: number, file: string, line: number }[]}
 */
export function deadOccurrences(occurrences, dead) {
  return occurrences.filter(({ ref }) => dead.has(ref));
}

/**
 * Строка вида `путь:строка: #номер` — формат сообщения и для теста, и для сетевой проверки.
 * @param {{ ref: number, file: string, line: number }} occurrence
 * @returns {string}
 */
export function formatOccurrence({ ref, file, line }) {
  return `${file}:${line}: #${ref}`;
}
