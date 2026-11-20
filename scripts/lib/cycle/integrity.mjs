/**
 * Контроль целостности проверок: правка тестов и защищённых файлов должна быть видна
 * (issue #27, docs/orchestrator-core.md §5.4, docs/orchestrator.md §14).
 *
 * Самый частый способ сделать цикл зелёным — ослабить проверки: удалить или упростить
 * тест, поправить конфиг гейтов, переписать команды проверок. Ядро не запрещает такие
 * правки (запрет замораживал бы `code`-агента), но превращает их в факт артефакта:
 * `cycle-evidence packet` пишет `evidence/integrity.json` со списком изменённых файлов,
 * попавших под правила проекта, а `cycle-pr-body` печатает их в «Проверках».
 *
 * Правила — только из конфига проекта (`.pi/harness.config.json`, секция `integrity`):
 * `testPaths` (что считать тестами) и `protectedPaths` (что агент не должен править молча).
 * Пустой список — правило не задано, ядро ничего не додумывает.
 *
 * Сопоставление путей — детерминированное, без зависимостей: `*` — внутри одного сегмента,
 * `**` — ноль или больше сегментов, `?` не поддерживается намеренно (нечем обосновать).
 * Правило без wildcard задевает и всё внутри одноимённого каталога: `tests` и `tests/**`
 * эквивалентны (как префиксы в `qaWeb.pathPrefixes`), поэтому проект может перечислять и
 * каталоги, и точные файлы.
 *
 * Shebang не нужен: модуль подключается из CLI-скриптов `cycle-*.mjs`.
 */

/** Статусы изменения файла: те же три группы в документе артефакта. */
const CHANGE_STATUSES = Object.freeze(['added', 'modified', 'deleted']);

/**
 * @typedef {'added'|'modified'|'deleted'} ChangeStatus
 */

/**
 * @typedef {object} FileChange
 * @property {string} path путь относительно корня репозитория
 * @property {ChangeStatus} status что произошло с файлом относительно базы
 */

/**
 * @typedef {object} IntegrityGroup
 * @property {string[]} added
 * @property {string[]} modified
 * @property {string[]} deleted
 */

/**
 * @typedef {object} IntegrityDoc
 * @property {string[]} test_paths правила тестов, с которыми считали
 * @property {string[]} protected_paths правила защищённых файлов, с которыми считали
 * @property {IntegrityGroup} tests тесты, затронутые диффом
 * @property {IntegrityGroup} protected защищённые файлы, затронутые диффом
 */

/**
 * Задано ли хоть одно правило: без правил артефакт не пишется, а лишний пустой файл
 * в пакете свидетельств выглядел бы как проверка, которой нет.
 * @param {{ testPaths?: readonly string[], protectedPaths?: readonly string[] }|null|undefined} rules
 * @returns {boolean}
 */
export function integrityConfigured(rules) {
  if (rules === null || rules === undefined) return false;
  const tests = Array.isArray(rules.testPaths) ? rules.testPaths.length : 0;
  const guarded = Array.isArray(rules.protectedPaths) ? rules.protectedPaths.length : 0;
  return tests + guarded > 0;
}

/**
 * Путь на сегменты: пустые сегменты и `.` отбрасываются, `..` не должен доходить сюда
 * (его отвергает загрузчик конфига, а пути из git его не содержат).
 * @param {string} value
 * @returns {string[]}
 */
function segments(value) {
  return value.split('/').filter((segment) => segment !== '' && segment !== '.');
}

/**
 * Экранирование символа для регулярного выражения.
 * @param {string} char
 * @returns {string}
 */
function escapeRegExp(char) {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

/**
 * Сопоставление одного сегмента шаблона с сегментом пути: `*` — любая последовательность
 * внутри сегмента (включая пустую), остальные символы — буквально.
 * @param {string} pattern сегмент шаблона
 * @param {string} value сегмент пути
 * @returns {boolean}
 */
function matchSegment(pattern, value) {
  if (!pattern.includes('*')) return pattern === value;
  const source = [...pattern].map((char) => (char === '*' ? '[^/]*' : escapeRegExp(char))).join('');
  return new RegExp(`^${source}$`, 'u').test(value);
}

/**
 * Сопоставление сегментов шаблона и пути: `**` раскрывается в ноль или больше сегментов.
 * @param {string[]} pattern
 * @param {string[]} path
 * @returns {boolean}
 */
function matchSegments(pattern, path) {
  const [head, ...rest] = pattern;
  if (head === undefined) return path.length === 0;
  if (head === '**') {
    for (let skip = 0; skip <= path.length; skip += 1) {
      if (matchSegments(rest, path.slice(skip))) return true;
    }
    return false;
  }
  const [first, ...tail] = path;
  if (first === undefined) return false;
  return matchSegment(head, first) && matchSegments(rest, tail);
}

/**
 * Подпадает ли путь под правило. Правило без завершающего `**` задевает и вложенные
 * файлы (`tests` → `tests/a/b.test.mjs`), поэтому каталог и файл задаются одинаково.
 * @param {string} pattern правило из конфига
 * @param {string} path путь относительно корня репозитория
 * @returns {boolean}
 */
export function matchesPath(pattern, path) {
  const rules = segments(pattern);
  if (rules.length === 0) return false;
  const target = segments(path);
  return matchSegments(rules, target) || matchSegments([...rules, '**'], target);
}

/**
 * Пустая группа: три списка в фиксированном порядке.
 * @returns {IntegrityGroup}
 */
function emptyGroup() {
  return { added: [], modified: [], deleted: [] };
}

/**
 * Группа с отсортированными списками: порядок файлов не зависит от порядка вывода git,
 * поэтому повторный прогон на том же диффе даёт побайтно тот же артефакт.
 * @param {IntegrityGroup} group
 * @returns {IntegrityGroup}
 */
function sortedGroup(group) {
  return {
    added: [...group.added].sort(),
    modified: [...group.modified].sort(),
    deleted: [...group.deleted].sort(),
  };
}

/**
 * Классификация изменённых файлов по правилам проекта. Чистая функция: ни файлов, ни git,
 * ни времени, ни случайности — вход и выход проверяются тестами побайтно.
 * @param {{
 *   changes: FileChange[],
 *   integrity: { testPaths?: readonly string[], protectedPaths?: readonly string[] },
 * }} input
 * @returns {IntegrityDoc}
 */
export function classifyIntegrity({ changes, integrity }) {
  const testPaths = Array.isArray(integrity.testPaths) ? [...integrity.testPaths] : [];
  const protectedPaths = Array.isArray(integrity.protectedPaths)
    ? [...integrity.protectedPaths]
    : [];

  const tests = emptyGroup();
  const guarded = emptyGroup();

  for (const change of changes) {
    if (!CHANGE_STATUSES.includes(change.status)) {
      throw new TypeError(`classifyIntegrity: неизвестный статус ${JSON.stringify(change.status)}`);
    }
    // Один файл может подпадать и под тесты, и под защищённые пути (например, конфиг тестов):
    // это две независимые линзы, а не альтернатива — файл попадает в обе.
    if (testPaths.some((pattern) => matchesPath(pattern, change.path))) {
      tests[change.status].push(change.path);
    }
    if (protectedPaths.some((pattern) => matchesPath(pattern, change.path))) {
      guarded[change.status].push(change.path);
    }
  }

  return {
    test_paths: testPaths,
    protected_paths: protectedPaths,
    tests: sortedGroup(tests),
    protected: sortedGroup(guarded),
  };
}
