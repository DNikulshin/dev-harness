#!/usr/bin/env node
/** Имена файлов внутри `evidence/`. Экспорт — для `cycle-driver`: он проверяет наличие пакета. */
export declare const EVIDENCE_FILES: Readonly<{
    issue: "issue.md";
    criteria: "criteria.md";
    diff: "diff.patch";
    gates: "gates.json";
    integrity: "integrity.json";
    qaWeb: "qa-web.json";
}>;
export type Criterion = {
    /**
     * `C1`, `C2`, …
     */
    id: string;
    /**
     * формулировка критерия
     */
    text: string;
};
export type IssueSection = {
    /**
     * заголовок секции без `###`
     */
    title: string;
    /**
     * текст секции без краевых пробелов
     */
    text: string;
};
export type CriteriaExtraction = {
    /**
     * критерии извлечены
     */
    ok: boolean;
    /**
     * причина отказа (`criteria_missing`)
     */
    reason: string | null;
    /**
     * пояснение для stderr
     */
    detail: string | null;
    /**
     * использованная секция формы
     */
    section: string | null;
    /**
     * шаблон формы: `feature`, `task` или `bug`
     */
    template: string | null;
    /**
     * пункты `C1…Cn`
     */
    criteria: Criterion[];
};
/**
 * @typedef {object} Criterion
 * @property {string} id `C1`, `C2`, …
 * @property {string} text формулировка критерия
 */
/**
 * @typedef {object} IssueSection
 * @property {string} title заголовок секции без `###`
 * @property {string} text текст секции без краевых пробелов
 */
/**
 * @typedef {object} CriteriaExtraction
 * @property {boolean} ok критерии извлечены
 * @property {string|null} reason причина отказа (`criteria_missing`)
 * @property {string|null} detail пояснение для stderr
 * @property {string|null} section использованная секция формы
 * @property {string|null} template шаблон формы: `feature`, `task` или `bug`
 * @property {Criterion[]} criteria пункты `C1…Cn`
 */
/**
 * Секции `### <заголовок>` тела issue. Секция продолжается до следующего заголовка
 * того же уровня; при повторе заголовка используется первая секция (порядок формы).
 * @param {string} body тело issue
 * @returns {IssueSection[]}
 */
export declare function parseSections(body: string): IssueSection[];
/**
 * Элементы списка секции: маркер (`- `, `* `, `1.`) и чекбокс срезаются, формулировка
 * сохраняется дословно. Пустые пункты и `_No response_` в списке не считаются критериями.
 *
 * Строки без маркера — продолжение текущего пункта: они присоединяются к формулировке
 * через один пробел, пока не встретится следующий маркер, пустая строка или конец текста.
 * Пустая строка закрывает пункт, поэтому абзац после списка критерием не становится,
 * а многострочный пункт остаётся одним критерием.
 * @param {string} text текст секции
 * @returns {string[]}
 */
export declare function parseListItems(text: string): string[];
/**
 * Извлекает критерии приёмки из issue (docs/orchestrator-core.md §5.4). Чистая функция:
 * вход — `{ title, body, labels }` в форме `gh issue view --json title,body,labels`.
 * Порядок секций зависит от метки `type:bug`; для bug без списка критерием становится
 * весь текст секции `Ожидаемый результат`.
 * @param {{ title?: unknown, body?: unknown, labels?: unknown }} issue
 * @returns {CriteriaExtraction}
 */
export declare function extractCriteria(issue: {
    title?: unknown;
    body?: unknown;
    labels?: unknown;
}): CriteriaExtraction;
/**
 * `evidence/issue.md`: заголовок issue и тело дословно.
 * @param {string} title
 * @param {string} body
 * @returns {string}
 */
export declare function renderIssue(title: string, body: string): string;
/**
 * `evidence/criteria.md`: заголовок, источник (секция и шаблон) и пункты `C1…Cn`
 * в строчном виде — по строке на критерий, чтобы id однозначно читались оценщиком.
 * @param {{ section: string, template: string|null, criteria: Criterion[] }} extraction
 * @returns {string}
 */
export declare function renderCriteria({ section, template, criteria }: {
    section: string;
    template: string | null;
    criteria: Criterion[];
}): string;
/**
 * Число изменённых строк диффа: добавления и удаления внутри ханков. Разбор структурный,
 * как в `git.addedLines`: заголовки файлов (`diff --git`, `index`, `---`, `+++`,
 * `new file mode`, `Binary files`) и контекст не считаются, `\ No newline at end of file`
 * тоже. Поэтому лимит §5.2 считается по фактическим изменениям, а не по размеру патча.
 * @param {string} diff вывод `git diff`
 * @returns {number}
 */
export declare function countChangedLines(diff: string): number;
/**
 * Проверка лимитов диффа (§5.2): изменённые строки и байты сырого диффа. Ровно на границе
 * превышения нет — `diff_too_large` начинается со следующего значения.
 * @param {string} diff сырой вывод `git diff`
 * @param {{ maxDiffLines: number, maxDiffBytes: number }} [limits]
 * @returns {{ lines: number, bytes: number, tooLarge: boolean }}
 */
export declare function diffLimits(diff: string, limits?: {
    maxDiffLines: number;
    maxDiffBytes: number;
}): {
    lines: number;
    bytes: number;
    tooLarge: boolean;
};
/**
 * Проверка каталога цикла на право записи (§4: скрипты пишут только в `.pi/artifacts/<…>/`).
 * Каталог вне корня репозитория разрешён: так работают тесты и ручной smoke на временных
 * git-репозиториях. Каталог внутри корня обязан лежать в `<root>/.pi/artifacts/`.
 * Экспортируется, чтобы тот же гард (с уроком issue #155 про символические ссылки)
 * использовал `cycle-state.mjs`, а не дублировал защиту.
 * @param {string} dir каталог цикла
 * @param {string} root корень репозитория
 * @returns {void}
 */
export declare function assertWritableDir(dir: string, root: string): void;
/**
 * Читает `issue.json`, подготовленный супервизором: `gh issue view N --json
 * title,body,labels`. Валидация защитная — файл пишет не этот скрипт.
 * @param {string} file
 * @returns {{ title: string, body: string, labels: unknown }}
 */
export declare function readIssue(file: string): {
    title: string;
    body: string;
    labels: unknown;
};
export type EvidenceFile = {
    /**
     * путь относительно каталога цикла (`evidence/…`)
     */
    path: string;
    /**
     * содержимое файла
     */
    text: string;
};
export type PacketPlan = {
    /**
     * дифф больше лимита (§5.2)
     */
    tooLarge: boolean;
    /**
     * изменённых строк сырого диффа
     */
    lines: number;
    /**
     * размер сырого диффа
     */
    bytes: number;
    /**
     * разрешённый полный sha базы диффа
     */
    baseSha: string;
    /**
     * номер итерации цикла
     */
    iteration: number;
    /**
     * файлы пакета
     */
    files: EvidenceFile[];
};
/**
 * Разбирает аргументы командной строки: подкоманда и её опции. Любой мусор, в том числе
 * опция другой подкоманды, — ошибка использования (код 2).
 * @param {string[]} argv аргументы без `node` и имени скрипта
 * @returns {{ command: 'criteria'|'packet', dir: string|null, issueJson: string|null, base: string|null }}
 */
export declare function parseArgs(argv: string[]): {
    command: 'criteria' | 'packet';
    dir: string | null;
    issueJson: string | null;
    base: string | null;
};
