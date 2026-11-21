#!/usr/bin/env node
import { Transform } from 'node:stream';
export type GateOutcome = {
    /**
     * итог запуска
     */
    status: 'pass' | 'fail' | 'not_run';
    /**
     * код возврата процесса (`null` — нет кода)
     */
    exit: number | null;
    /**
     * длительность в секундах
     */
    duration_s: number;
    /**
     * причина §5.5 или `null`
     */
    reason: string | null;
};
export type GateEntry = {
    id: string;
    cmd: string | null;
    required: boolean;
    status: 'pass' | 'fail' | 'skipped' | 'not_run';
    exit: number | null;
    duration_s: number;
    /**
     * путь лога относительно каталога цикла
     */
    log: string | null;
    reason: string | null;
};
export type GatePlanItem = {
    id: string;
    /**
     * что делать с гейтом в этом прогоне
     */
    decision: 'run' | 'skip' | 'inherit';
    /**
     * причина для `skipped`/`not_run` или `null`
     */
    reason: string | null;
};
/**
 * Запускается ли гейт при таком диффе (§5.5). Пустой список префиксов — «всегда»;
 * точное совпадение нужно для условий-файлов (`AGENTS.md`), префикс — для каталогов.
 * @param {{ pathPrefixes: readonly string[] }} definition
 * @param {string[]} changed изменённые файлы от базы
 * @returns {boolean}
 */
export declare function isGateApplicable(definition: {
    pathPrefixes: readonly string[];
}, changed: string[]): boolean;
/**
 * План прогона: порядок, условие запуска и наследование статусов при `--only`.
 * Чистая функция — процессы не запускает и файлов не читает. Зависимости разрешает
 * `runGates`: статус родителя известен только после его выполнения, а наследованный
 * статус родителя уже есть в `inherited` (уточнение супервизора, п. 1).
 * @param {readonly { id: string, pathPrefixes: readonly string[] }[]} definitions
 * @param {{ changed?: string[], only?: string[]|null, inherited?: Record<string, GateEntry> }} [options]
 * @returns {GatePlanItem[]}
 */
export declare function planRun(definitions: readonly {
    id: string;
    pathPrefixes: readonly string[];
}[], { changed, only, inherited }?: {
    changed?: string[];
    only?: string[] | null;
    inherited?: Record<string, GateEntry>;
}): GatePlanItem[];
/**
 * Классифицирует лог `test_int` (§5.5): ошибки соединения — `no_database`, всё остальное,
 * включая `password authentication failed`, — `fail`. Чистая функция: вход — только текст
 * лога, поэтому тесты идут на образцах из `scripts/fixtures/cycle/`.
 * @param {unknown} text содержимое лога гейта (нестрока — `TypeError`)
 * @returns {'no_database'|'fail'}
 */
export declare function classifyTestIntLog(text: unknown): 'no_database' | 'fail';
/**
 * Находки `secrets_scan` по добавленным строкам диффа (§5.5): только `file:line` и вид
 * находки, значение секрета не сохраняется. Исключений по имени файла нет: `.env.example`
 * сканируется как любой другой файл, а «образцовость» определяется значением (заглушки
 * отсекает `scanSecrets`, §5.5). `scanSecrets` нумерует строки относительно переданного
 * массива, поэтому номер строки в файле берётся из элемента `addedLinesByFile`.
 * @param {unknown} files массив `{ file, lines }` (не массив — `TypeError`)
 * @returns {{ file: string, line: number, kind: string }[]}
 */
export declare function scanAddedLines(files: unknown): {
    file: string;
    line: number;
    kind: string;
}[];
/**
 * Оставляет в логе хвост, укладывающийся в `maxBytes` (§5.2, §5.5).
 * `io.tail` отрезает по строкам, поэтому подходящее число строк ищется делением отрезка:
 * каждая строка занимает минимум один байт, значит строк не больше, чем байт в файле.
 * Путь редкий (5 МБ вывода одного гейта — уже аномалия), поэтому повторное чтение хвоста
 * на каждом шаге приемлемо. `tail` отдаёт хвост без завершающего перевода строки —
 * возвращаем его, чтобы файл оставался текстовым логом.
 * @param {string} file
 * @param {number} [maxBytes] предел размера лога; по умолчанию из нейтральных лимитов
 * @returns {boolean} true, если лог был обрезан
 */
export declare function trimLog(file: string, maxBytes?: number): boolean;
/**
 * Переменные, которые гейт получает всегда (ADR 0007, в): `PATH` нужен, чтобы разрешился
 * `executable`, `HOME` — чтобы работали кэши `pnpm`/`npm`, `TMPDIR` — чтобы было куда писать
 * временные файлы. Секретов в этом списке нет и не появится: список — часть контракта.
 * @type {readonly string[]}
 */
export declare const SERVICE_ENV: readonly string[];
/**
 * Окружение процесса гейта: наследуется от текущего процесса плюс `TURBO_FORCE=true`.
 *
 * Объявленное окружение (ADR 0007, б) выключает наследование: гейт получает служебные
 * переменные, `allow`-переменные из базового окружения и литеральные `set` — и ничего больше.
 * Значит секрет, не названный в `allow`, до гейта не доходит; секрет, попавший в лог, всё равно
 * маскируется (§5.4), то есть это не замена маскированию, а сужение поверхности.
 *
 * `TURBO_FORCE` ставится последним и не переопределяется: `pass` без живого прогона — ложное
 * свидетельство, и «умное» окружение не должно его отключать.
 *
 * Без этого turbo отдаёт результат из кэша («FULL TURBO»), и `pass` в `gates.<n>.json`
 * означал бы «эти входы когда-то уже проверялись», а не живой прогон (§5.5, #216). Кэш
 * turbo адресуется по хешу входов, но часть окружения в хеш не входит, а гейты — основное
 * свидетельство «код проверен»; цена принудительного прогона в этом репозитории — секунды
 * (contracts_build 3 с, typecheck 11 с, lint 9 с, test 12 с), поэтому выбирается свежесть.
 * Затрагивает только задачи turbo: `test_int` в `turbo.json` уже `cache: false`, а
 * `check_arch`, `check_harness`, `format_check`, `lint:workflows` и `test:scripts`
 * кэша не имеют.
 * @param {NodeJS.ProcessEnv} [base] базовое окружение (в тестах — подмена)
 * @param {import('./lib/cycle/config.mjs').GateEnv|null} [declaration] объявленный `env` гейта
 *   (`null` — объявления нет, наследование полное)
 * @returns {NodeJS.ProcessEnv} окружение для `spawn`
 */
export declare function gateEnv(base?: NodeJS.ProcessEnv, declaration?: import('./lib/cycle/config.mjs').GateEnv | null): NodeJS.ProcessEnv;
/**
 * Поток маскирования вывода гейта (§5.4, §5.5): `redactLog` применяется до записи в файл,
 * поэтому секрет из stdout/stderr не оказывается на диске даже на время.
 *
 * Pipe отдаёт данные кусками, поэтому текст копится до последнего перевода строки, а
 * необработанный хвост ждёт следующего куска или `flush`: иначе секрет, разрезанный между
 * двумя кусками, ни одному шаблону не подошёл бы. Шаблоны `redactLog` не переходят через
 * `\n`, так что маскирование готового блока целиком эквивалентно построчному, а нумерация
 * строк сохраняется — §5.4 требует именно этого. `StringDecoder` не даёт разрезать
 * многобайтовый символ на границе куска.
 * @returns {Transform} поток маскирования
 */
export declare function createRedactStream(): Transform;
/**
 * Полный прогон: план, последовательное выполнение, зависимости и записи гейтов.
 * Чистая относительно файловой системы — пишет только `secrets_scan` и (через `runner`)
 * логи гейтов; `gates.<n>.json` формируется здесь и пишется вызывающим.
 * @param {{
 *   definitions?: readonly import('./lib/cycle/config.mjs').LoadedGate[],
 *   changed?: string[],
 *   added?: { file: string, lines: { line: number, text: string }[] }[],
 *   only?: string[]|null,
 *   inherited?: Record<string, GateEntry>,
 *   iteration: number,
 *   dir: string,
 *   root?: string,
 *   timeouts?: Record<string, number>,
 *   limits?: { logMaxBytes: number },
 *   graceMs?: number,
 *   now?: () => number,
 *   runner?: (definition: import('./lib/cycle/config.mjs').LoadedGate, options: any) => Promise<GateOutcome>,
 * }} options
 * @returns {Promise<{ started_at: string, gates: GateEntry[] }>}
 */
export declare function runGates(options: {
    definitions?: readonly import('./lib/cycle/config.mjs').LoadedGate[];
    changed?: string[];
    added?: {
        file: string;
        lines: {
            line: number;
            text: string;
        }[];
    }[];
    only?: string[] | null;
    inherited?: Record<string, GateEntry>;
    iteration: number;
    dir: string;
    root?: string;
    timeouts?: Record<string, number>;
    limits?: {
        logMaxBytes: number;
    };
    graceMs?: number;
    now?: () => number;
    runner?: (definition: import('./lib/cycle/config.mjs').LoadedGate, options: any) => Promise<GateOutcome>;
}): Promise<{
    started_at: string;
    gates: GateEntry[];
}>;
/**
 * Полный sha базы для диффа и документа. `--base` может быть именем ссылки (`main`), но
 * `base_sha` в `gates.<n>.json` принимается только как полный sha (Приложение A), поэтому
 * ссылка резолвится через `git rev-parse` до запуска гейтов. Недопустимая или
 * несуществующая ссылка — ошибка использования: CLI вернёт 2 и документ не запишет.
 * @param {{ base: string, cwd?: string }} options
 * @returns {string}
 */
export declare function resolveBaseSha({ base, cwd }: {
    base: string;
    cwd?: string;
}): string;
/**
 * Разбирает аргументы командной строки. Любой мусор — ошибка использования (код 2).
 * `--base` здесь не резолвится: разбор остаётся чистым, резолв — `resolveBaseSha`.
 * @param {string[]} argv
 * @param {readonly string[]} [gateIds] id гейтов из конфига: `--only` принимает только их
 * @returns {{ dir: string|null, only: string[]|null, base: string|null }}
 */
export declare function parseArgs(argv: string[], gateIds?: readonly string[]): {
    dir: string | null;
    only: string[] | null;
    base: string | null;
};
/**
 * Код выхода по документу гейтов (§5.5): `0` — обязательных `fail` нет, `1` — есть.
 * Код `2` ставит `main` при любой ошибке использования или внутренней ошибке.
 * @param {{ gates: Record<string, unknown>[] }} doc
 *   читаются только `required` и `status`, поэтому частичные документы допустимы
 * @returns {0|1}
 */
export declare function exitCode(doc: {
    gates: Record<string, unknown>[];
}): 0 | 1;
