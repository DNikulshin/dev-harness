/**
 * Sha базовой ветки: от него считается дифф цикла.
 * @param {{ branch?: string, cwd?: string }} [options]
 * @returns {string}
 */
export declare function baseSha({ branch, cwd }?: {
    branch?: string;
    cwd?: string;
}): string;
/**
 * Текущая ветка (`git rev-parse --abbrev-ref HEAD`). Отделённый `HEAD` даёт строку
 * `HEAD` — она не совпадёт ни с одной веткой цикла, и это правильный ответ: коммит
 * в отделённом состоянии не попадает в ветку артефактов.
 * @param {{ cwd?: string }} [options]
 * @returns {string}
 */
export declare function currentBranch({ cwd }?: {
    cwd?: string;
}): string;
/**
 * Существует ли локальная ветка. `show-ref --verify --quiet` не пишет в stdout и
 * завершается кодом 1 для отсутствующей ссылки — `execFileSync` в этом случае бросает.
 * Полное имя ссылки строится здесь (`refs/heads/…`), поэтому значение не может стать
 * опцией git.
 * @param {unknown} branch имя ветки
 * @param {{ cwd?: string }} [options]
 * @returns {boolean}
 */
export declare function branchExists(branch: unknown, { cwd }?: {
    cwd?: string;
}): boolean;
/**
 * Делает untracked-файлы видимыми в `git diff` через `--intent-to-add`.
 * Это единственное разрешённое вмешательство в индекс (§4): содержимое файлов не меняется,
 * новые файлы видны при этом только в диффе от базы, но не в HEAD.
 * Пустой результат — штатный no-op.
 * @param {{ cwd?: string }} [options]
 * @returns {string[]} файлы, добавленные в индекс как intent-to-add
 */
export declare function intentToAddUntracked({ cwd }?: {
    cwd?: string;
}): string[];
/**
 * Дифф рабочего дерева от базы (включая staged-изменения и intent-to-add).
 * @param {string} base sha или имя ветки
 * @param {{ cwd?: string }} [options]
 * @returns {string}
 */
export declare function diffFromBase(base: string, { cwd }?: {
    cwd?: string;
}): string;
/**
 * Изменённые файлы от базы. Переименования не разворачиваются: старый и новый путь
 * считаются обычными изменениями (диффы короче, условия гейтов проще).
 * @param {string} base sha или имя ветки
 * @param {{ cwd?: string }} [options]
 * @returns {string[]}
 */
export declare function changedFiles(base: string, { cwd }?: {
    cwd?: string;
}): string[];
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
/**
 * Изменённые файлы от базы со статусом (`--name-status -z`): вход контроля целостности
 * проверок (#27, §5.4). `-z` обязателен: без него git кавычит не-ASCII имена и путь с
 * табуляцией/переводом строки ломает разбор. Переименования не разворачиваются
 * (`--no-renames`, как у `changedFiles`): переименованный тест виден как удаление старого
 * и добавление нового, иначе правка теста выглядела бы как будто нетронутый файл.
 * @param {string} base sha или имя ветки
 * @param {{ cwd?: string }} [options]
 * @returns {FileChange[]}
 */
export declare function changedFilesWithStatus(base: string, { cwd }?: {
    cwd?: string;
}): FileChange[];
/**
 * Добавленные строки диффа без префикса `+` — вход для `scanSecrets`.
 * Разбор структурный, а не по префиксам: заголовок файла (`diff --git`, `index`, `---`,
 * `+++`, `new file mode`, `deleted file mode`, `similarity index`, `rename from/to`,
 * `Binary files`) встречается только вне ханков, ханк начинается с `@@`. Внутри ханка
 * добавлены строки с `+` (их содержимое может само начинаться с `++`), контекст, удаления
 * и маркеры `\ No newline at end of file` пропускаются. Поэтому заголовки `+++ b/...`
 * в результат не попадают.
 * @param {string} diff вывод `git diff`
 * @returns {string[]}
 */
export declare function addedLines(diff: string): string[];
export type AddedLine = {
    /**
     * номер строки в новой версии файла (из заголовка ханка)
     */
    line: number;
    /**
     * содержимое строки без префикса `+`
     */
    text: string;
};
/**
 * Добавленные строки диффа с именами файлов и номерами строк в новой версии файла.
 * Вход для `secrets_scan` (§5.5): в логе находки нужен `file:line`, а `addedLines`
 * отдаёт только текст. Разбор структурный, как у `addedLines`: вне ханка встречаются
 * только заголовки (`diff --git`, `index`, `---`, `+++`, `new file mode`, `rename from/to`,
 * `Binary files`), поэтому имя файла берётся из `+++ b/…`, а нумерация — из `@@ … +c,d @@`.
 * Внутри ханка добавление (`+`), удаление (`-`, номер новой версии не двигает), контекст
 * (двигает) и `\ No newline at end of file` (не двигает). Файлы без добавленных строк
 * (удаление, бинарный дифф, смена режима) в результат не попадают.
 * @param {string} diff вывод `git diff`
 * @returns {{ file: string, lines: AddedLine[] }[]}
 */
export declare function addedLinesByFile(diff: string): {
    file: string;
    lines: AddedLine[];
}[];
