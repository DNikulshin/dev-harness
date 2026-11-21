/**
 * Области, в которых номера проверяются: код ядра и норматив. Расширения разные, поэтому
 * проверка идёт по каталогу, а не по всему репозиторию: `evals/`, `templates/` и `tooling/`
 * намеренно вне области — там номера встречаются в примерах и фикстурах.
 * @type {readonly { dir: string, ext: string }[]}
 */
export declare const REF_SCOPES: readonly {
    dir: string;
    ext: string;
}[];
/**
 * Каталоги внутри областей, где номера не проверяются: исторические документы и журнал переноса
 * ссылаются на чужой трекер и на номера, которых в этом репозитории нет (решение #129, п. «что не
 * входит»). Пути — от корня репозитория, с `/` как разделителем.
 * @type {readonly string[]}
 */
export declare const REF_EXCLUDES: readonly string[];
/**
 * Номера, упомянутые в тексте: в порядке появления, без повторов.
 * @param {string} text
 * @returns {number[]}
 */
export declare function refsInText(text: string): number[];
/**
 * Файлы, в которых ищутся ссылки: относительные posix-пути, отсортированные. Область может
 * отсутствовать в рабочей копии (например, каталог ещё не создан) — это не ошибка.
 * @param {string} root корень репозитория
 * @param {{ scopes?: readonly { dir: string, ext: string }[], excludes?: readonly string[] }} [options]
 * @returns {string[]}
 */
export declare function refFiles(root: string, options?: {
    scopes?: readonly {
        dir: string;
        ext: string;
    }[];
    excludes?: readonly string[];
}): string[];
/**
 * Все упоминания номеров issue в области: по одному элементу на вхождение, в порядке файлов и
 * строк. Повторы одного номера в разных строках остаются разными элементами — адрес нарушения
 * нужен точный.
 * @param {string} root корень репозитория
 * @param {{ scopes?: readonly { dir: string, ext: string }[], excludes?: readonly string[] }} [options]
 * @returns {{ ref: number, file: string, line: number }[]}
 */
export declare function collectRefs(root: string, options?: {
    scopes?: readonly {
        dir: string;
        ext: string;
    }[];
    excludes?: readonly string[];
}): {
    ref: number;
    file: string;
    line: number;
}[];
/**
 * Уникальные номера из собранных вхождений, по возрастанию: резолвить один номер дважды незачем.
 * @param {{ ref: number }[]} occurrences
 * @returns {number[]}
 */
export declare function refNumbers(occurrences: {
    ref: number;
}[]): number[];
/**
 * Вхождения, номера которых помечены мёртвыми. Возвращает адреса, а не номера: сообщение должно
 * показывать `файл:строка`, иначе искать нарушение вручную.
 * @param {{ ref: number, file: string, line: number }[]} occurrences
 * @param {ReadonlySet<number>} dead
 * @returns {{ ref: number, file: string, line: number }[]}
 */
export declare function deadOccurrences(occurrences: {
    ref: number;
    file: string;
    line: number;
}[], dead: ReadonlySet<number>): {
    ref: number;
    file: string;
    line: number;
}[];
/**
 * Строка вида `путь:строка: #номер` — формат сообщения и для теста, и для сетевой проверки.
 * @param {{ ref: number, file: string, line: number }} occurrence
 * @returns {string}
 */
export declare function formatOccurrence({ ref, file, line }: {
    ref: number;
    file: string;
    line: number;
}): string;
