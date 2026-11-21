#!/usr/bin/env node
import { loadConfig } from './lib/cycle/config.mjs';
/** Класс ошибки использования: код 2. */
export declare class UsageError extends Error {
}
/**
 * Разбирает аргументы командной строки.
 * @param {string[]} argv аргументы без имени скрипта
 * @returns {{ command: string, dir: string|null, root: string|null, maxSteps: number }}
 */
export declare function parseArgs(argv: string[]): {
    command: string;
    dir: string | null;
    root: string | null;
    maxSteps: number;
};
/**
 * Присутствие артефактов на диске. Один проход по файлам: планировщик решает по флагам, а не
 * по файловой системе, поэтому его можно тестировать без временных каталогов.
 * @param {string} dir каталог цикла
 * @param {string} artifactsDir каталог артефактов (там лежит `.lock`)
 * @param {ReturnType<typeof loadConfig>} config конфиг проекта
 * @param {number} iteration номер итерации
 * @param {boolean} webDiff дифф затрагивает web-приложение
 * @returns {import('./lib/cycle/driver.mjs').DriverArtifacts}
 */
export declare function readArtifacts(dir: string, artifactsDir: string, config: ReturnType<typeof loadConfig>, iteration: number, webDiff: boolean): import('./lib/cycle/driver.mjs').DriverArtifacts;
/**
 * Команды для токена шага. Возвращает готовые строки — их печатают и исполняют.
 * @param {import('./lib/cycle/driver.mjs').DriverStep} step дескриптор шага
 * @param {string} dir каталог цикла
 * @param {string} root корень репозитория
 * @returns {string[]}
 */
export declare function renderCommands(step: import('./lib/cycle/driver.mjs').DriverStep, dir: string, root: string): string[];
/**
 * Дифф от базы цикла затрагивает web-приложение. Ошибка git — не «нет диффа»: битая база
 * делает маршрутизацию неверной, поэтому отказ явный (код 2).
 * @param {string} base база цикла
 * @param {string} root корень репозитория
 * @param {ReturnType<typeof loadConfig>} config конфиг проекта
 * @returns {boolean}
 */
export declare function readWebDiff(base: string, root: string, config: ReturnType<typeof loadConfig>): boolean;
/**
 * Собирает дескриптор шага и состояние цикла по текущему каталогу.
 * @param {{ dir: string, root: string, config: ReturnType<typeof loadConfig> }} context
 * @returns {{
 *   step: import('./lib/cycle/driver.mjs').DriverStep,
 *   state: Record<string, any>,
 * }} шаг и разобранный `state.json`, который он прочитал
 */
export declare function nextPlan({ dir, root, config }: {
    dir: string;
    root: string;
    config: ReturnType<typeof loadConfig>;
}): {
    step: import('./lib/cycle/driver.mjs').DriverStep;
    state: Record<string, any>;
};
/**
 * Прежняя форма ответа — только шаг. Оставлена ради совместимости: `nextStep` объявлен в
 * `package.json#exports` (`./scripts/cycle-driver`), и смена возвращаемого типа сломала бы
 * потребителя, который импортирует функцию. Новым вызывающим — `nextPlan` (#151).
 * @param {{ dir: string, root: string, config: ReturnType<typeof loadConfig> }} context
 * @returns {import('./lib/cycle/driver.mjs').DriverStep}
 */
export declare function nextStep(context: {
    dir: string;
    root: string;
    config: ReturnType<typeof loadConfig>;
}): import('./lib/cycle/driver.mjs').DriverStep;
/**
 * Журнал решений драйвера. Нет файла — нет решений (цикл шёл без драйвера): это не ошибка,
 * а факт, который `metrics.json` покажет как `driver: null`.
 * @param {string} file путь к `driver.jsonl`
 * @returns {import('./lib/cycle/driver.mjs').DriverJournalEntry[]}
 */
export declare function readJournal(file: string): import('./lib/cycle/driver.mjs').DriverJournalEntry[];
