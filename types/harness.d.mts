#!/usr/bin/env node
/**
 * Команды диспетчера: имя → скрипт пакета. Список намеренно короткий: диспетчер не должен
 * превращаться во второй, неполный список CLI.
 * @type {Readonly<Record<string, string>>}
 */
export declare const COMMANDS: Readonly<Record<string, string>>;
/**
 * Подсказка по использованию.
 * @returns {string}
 */
export declare function usage(): string;
/**
 * Разбор команды: первый аргумент — имя, остальные уходят команде без изменений.
 * @param {string[]} argv аргументы после `harness`
 * @returns {{ script: string|null, rest: string[] }} `script === null` — подсказка без команды
 */
export declare function resolveCommand(argv: string[]): {
    script: string | null;
    rest: string[];
};
/**
 * Точка входа CLI.
 * @param {string[]} [argv]
 * @returns {number} код выхода
 */
export declare function main(argv?: string[]): number;
