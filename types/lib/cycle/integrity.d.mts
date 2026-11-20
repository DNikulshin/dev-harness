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
export type ChangeStatus = 'added' | 'modified' | 'deleted';
export type FileChange = {
    /**
     * путь относительно корня репозитория
     */
    path: string;
    /**
     * что произошло с файлом относительно базы
     */
    status: ChangeStatus;
};
export type IntegrityGroup = {
    added: string[];
    modified: string[];
    deleted: string[];
};
export type IntegrityDoc = {
    /**
     * правила тестов, с которыми считали
     */
    test_paths: string[];
    /**
     * правила защищённых файлов, с которыми считали
     */
    protected_paths: string[];
    /**
     * тесты, затронутые диффом
     */
    tests: IntegrityGroup;
    /**
     * защищённые файлы, затронутые диффом
     */
    protected: IntegrityGroup;
};
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
export declare function integrityConfigured(rules: {
    testPaths?: readonly string[];
    protectedPaths?: readonly string[];
} | null | undefined): boolean;
/**
 * Подпадает ли путь под правило. Правило без завершающего `**` задевает и вложенные
 * файлы (`tests` → `tests/a/b.test.mjs`), поэтому каталог и файл задаются одинаково.
 * @param {string} pattern правило из конфига
 * @param {string} path путь относительно корня репозитория
 * @returns {boolean}
 */
export declare function matchesPath(pattern: string, path: string): boolean;
/**
 * Классификация изменённых файлов по правилам проекта. Чистая функция: ни файлов, ни git,
 * ни времени, ни случайности — вход и выход проверяются тестами побайтно.
 * @param {{
 *   changes: FileChange[],
 *   integrity: { testPaths?: readonly string[], protectedPaths?: readonly string[] },
 * }} input
 * @returns {IntegrityDoc}
 */
export declare function classifyIntegrity({ changes, integrity }: {
    changes: FileChange[];
    integrity: {
        testPaths?: readonly string[];
        protectedPaths?: readonly string[];
    };
}): IntegrityDoc;
