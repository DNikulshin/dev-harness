#!/usr/bin/env node
import { loadConfig } from './lib/cycle/config.mjs';
/**
 * Имя файла версии шаблонов: версия пакета и дайджесты установленного. Лежит рядом с конфигом —
 * единственной фиксированной точкой раскладки (ADR 0005): на профиле с конфигом вне умолчания
 * версия едет за ним, а не остаётся в каталоге умолчаний.
 */
export declare const VERSION_NAME = "harness.version";
export type InstallLayout = {
    agentsDir: string;
    settings: string;
    cyclePrompt: string;
    config: string;
    version: string;
};
/**
 * Раскладка установки в проекте: куда ставить шаблоны и что считается установленным.
 * @typedef {{
 *   agentsDir: string,
 *   settings: string,
 *   cyclePrompt: string,
 *   config: string,
 *   version: string,
 * }} InstallLayout
 */
/**
 * Раскладка по умолчанию: умолчания ядра, собранные в одном месте. По ней работает установка в
 * чистый проект — конфига ещё нет, и спрашивать не у кого.
 * @returns {InstallLayout}
 */
export declare function defaultLayout(): InstallLayout;
/**
 * Раскладка установки по профилю проекта: пути берутся из конфига, который ядро и так читает.
 * @param {ReturnType<typeof loadConfig>} config конфиг проекта
 * @param {string} root корень проекта
 * @returns {InstallLayout}
 */
export declare function installLayout(config: ReturnType<typeof loadConfig>, root: string): InstallLayout;
/**
 * Путь в проекте для шаблона. Неизвестный шаблон — ошибка: положить файл «куда-нибудь» хуже,
 * чем отказаться, потому что дальше его никто не найдёт.
 * @param {string} source путь внутри каталога шаблонов (после его корня)
 * @param {InstallLayout} layout раскладка проекта
 * @returns {string}
 */
export declare function targetFor(source: string, layout: InstallLayout): string;
export type InitArgs = {
    root: string;
    templates: string;
    dryRun: boolean;
    check: boolean;
    force: boolean;
};
/**
 * Аргументы CLI.
 * @typedef {{
 *   root: string,
 *   templates: string,
 *   dryRun: boolean,
 *   check: boolean,
 *   force: boolean,
 * }} InitArgs
 */
/**
 * Разбирает аргументы CLI. Неизвестный аргумент — ошибка: молча игнорировать флаг опаснее,
 * чем упасть (человек будет уверен, что `--dry-run` сработал).
 * @param {string[]} argv
 * @returns {InitArgs}
 */
export declare function parseArgs(argv: string[]): InitArgs;
/**
 * `sha256` содержимого в единой форме — так его пишут и сравнивают.
 * @param {string} text
 * @returns {string}
 */
export declare function digest(text: string): string;
/**
 * Собирает шаблоны для установки: всё из `<templatesDir>/<CONFIG_FILE.dir>/**`, разложенное по
 * профилю проекта.
 * @param {string} templatesDir каталог шаблонов (в пакете — `templates/`)
 * @param {InstallLayout} [layout] раскладка проекта; по умолчанию умолчания ядра
 * @returns {{ source: string, target: string, text: string, digest: string }[]}
 *   `source` — путь внутри каталога шаблонов пакета (`.`-каталог включён), `target` — путь в
 *   проекте; порядок стабильный
 */
export declare function collectTemplates(templatesDir: string, layout?: InstallLayout): {
    source: string;
    target: string;
    text: string;
    digest: string;
}[];
/**
 * Читает `.pi/harness.version`. Нет файла — пустая запись (первая установка).
 * Битый файл — ошибка чтения: по нему решается, правили ли шаблоны, и догадка здесь
 * означала бы «затрём, наверное, не жалко».
 * @param {string} file абсолютный путь
 * @param {string} [label] путь для сообщения (`harness.version` рядом с конфигом)
 * @returns {{ version: string | null, templates: Record<string, string> }}
 */
export declare function readVersionFile(file: string, label?: string): {
    version: string | null;
    templates: Record<string, string>;
};
export type TargetState = 'create' | 'update' | 'current' | 'modified' | 'owned';
/**
 * Состояние одного файла установки.
 * @typedef {'create'|'update'|'current'|'modified'|'owned'} TargetState
 *   `create` — файла нет; `update` — локальных правок нет, шаблон новее; `current` — совпадает;
 *   `modified` — файл правили, без `--force` не трогаем; `owned` — файл принадлежит проекту
 *   (конфиг) и, раз он уже есть, не обновляется никогда.
 */
/**
 * План установки: что сделать с каждым шаблоном. Чистая функция по отношению к файловой
 * системе проекта — ничего не пишет, поэтому годится и для `--dry-run`, и для `--check`.
 * @param {object} options
 * @param {string} options.root каталог проекта
 * @param {{ source: string, target: string, text: string, digest: string }[]} options.templates
 * @param {Record<string, string>} options.recorded дайджесты из `harness.version`
 * @param {readonly string[]} [options.owned] файлы, принадлежащие проекту: конфиг по профилю
 *   раскладки — политика, а не шаблон, и после создания не обновляется даже `--force`
 *   (перезаписать гейты и лимиты примером из пакета — тихая потеря настроек)
 * @returns {{ entries: { target: string, state: TargetState, text: string, digest: string }[], removed: string[] }}
 */
export declare function planInstall({ root, templates, recorded, owned }: {
    root: string;
    templates: {
        source: string;
        target: string;
        text: string;
        digest: string;
    }[];
    recorded: Record<string, string>;
    owned?: readonly string[];
}): {
    entries: {
        target: string;
        state: TargetState;
        text: string;
        digest: string;
    }[];
    removed: string[];
};
/**
 * Лимит субагентов из `.pi/settings.json`.
 * @param {string} file
 * @returns {{ state: 'absent'|'current'|'low'|'invalid'|'unreadable', value: number | null }}
 *   `absent` — файла нет (создадим); `current` — лимит ≥ 7; `low` — меньше нормы (H5);
 *   `invalid` — поле не целое число; `unreadable` — файл есть, но это не JSON-объект
 */
export declare function readSettingsState(file: string): {
    state: 'absent' | 'current' | 'low' | 'invalid' | 'unreadable';
    value: number | null;
};
/**
 * Минимальные настройки: только то, чего требует H5. Остальное — дело проекта и pi.
 * @returns {Record<string, unknown>}
 */
export declare function minimalSettings(): Record<string, unknown>;
/**
 * Документ `.pi/harness.version`: версия пакета и дайджесты того, что поставили.
 *
 * Пропущенный файл (локальная правка без `--force`) сохраняет прежний дайджест или не попадает
 * в запись вовсе: записать его текущее содержимое значило бы объявить чужую правку «нашей» и
 * затереть её при следующем обновлении.
 * @param {{
 *   version: string,
 *   templates: { target: string, state: TargetState, digest: string }[],
 *   recorded: Record<string, string>,
 *   force: boolean,
 * }} options
 * @returns {Record<string, unknown>}
 */
export declare function buildVersionDoc({ version, templates, recorded, force }: {
    version: string;
    templates: {
        target: string;
        state: TargetState;
        digest: string;
    }[];
    recorded: Record<string, string>;
    force: boolean;
}): Record<string, unknown>;
/**
 * Версия пакета: единственный источник — `package.json` рядом со `scripts/`.
 * @param {string} root корень ядра
 * @returns {string}
 */
export declare function packageVersion(root: string): string;
/**
 * Установка шаблонов в проект.
 *
 * Побочные эффекты внедряются (`io.write`/`io.log`), чтобы тесты проверяли план и текст вывода,
 * не трогая дерево проекта.
 * @param {InitArgs} args
 * @param {{
 *   write?: (file: string, text: string) => void,
 *   log?: (line: string) => void,
 *   configFile?: string|null,
 * }} [io]
 *   `configFile` — путь конфига из `--config`/`HARNESS_CONFIG` (граница CLI, ADR 0005): он же
 *   цель установки и источник профиля раскладки
 * @returns {{ code: number, lines: string[] }}
 */
export declare function runInit(args: InitArgs, io?: {
    write?: (file: string, text: string) => void;
    log?: (line: string) => void;
    configFile?: string | null;
}): {
    code: number;
    lines: string[];
};
