/**
 * Маскирование ПДн и секретов (docs/orchestrator-core.md §5.4) и детектор гейта
 * `secrets_scan` (§5.5).
 *
 * Замены строго по таблице §5.4: строки не удаляются и не склеиваются (переводы строк
 * в шаблоны не входят), поэтому нумерация строк в диффе и логах не меняется.
 * Shebang не нужен: модуль подключается из CLI-скриптов `cycle-*.mjs`.
 */
/**
 * Маскирует ПДн и секреты в тексте лога (§5.4).
 * @param {string} text одна строка или многострочный текст
 * @returns {string}
 */
export declare function redactLog(text: string): string;
/**
 * Рекурсивно маскирует строковые значения, не меняя структуру: массивы, их длина и
 * `id` шагов QA остаются прежними (§5.4). Входной объект не мутируется — возвращается
 * новая структура той же формы.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export declare function redactQa<T>(value: T): T;
export type SecretFinding = {
    /**
     * номер элемента в `addedLines` (нумерация с 1)
     */
    line: number;
    /**
     * вид находки: `private_key`, `aws_access_key`, `jwt`,
     * `provider_token`, `password_url`, `bearer_token`, `assigned_secret`
     */
    kind: string;
};
/**
 * @typedef {object} SecretFinding
 * @property {number} line номер элемента в `addedLines` (нумерация с 1)
 * @property {string} kind вид находки: `private_key`, `aws_access_key`, `jwt`,
 *   `provider_token`, `password_url`, `bearer_token`, `assigned_secret`
 */
/**
 * Детектор гейта `secrets_scan` (§5.5): ищет секреты только в добавленных строках диффа.
 * Значение секрета в результат не попадает — только номер строки и вид находки.
 * Отсечение файла `.env.example` — забота вызывающего: у строк диффа здесь нет имени
 * файла (`git.addedLines` возвращает только текст).
 * @param {unknown} addedLines добавленные строки диффа без префикса `+` (не массив — `TypeError`)
 * @returns {SecretFinding[]}
 */
export declare function scanSecrets(addedLines: unknown): SecretFinding[];
