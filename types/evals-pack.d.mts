#!/usr/bin/env node
/**
 * Разбирает аргументы командной строки.
 * @param {string[]} argv
 * @returns {{ seed: string|null, config: string, out: string|null, now: string|null, repeat: number, force: boolean, root: string|null }}
 */
export declare function parseArgs(argv: string[]): {
    seed: string | null;
    config: string;
    out: string | null;
    now: string | null;
    repeat: number;
    force: boolean;
    root: string | null;
};
/**
 * Дата для имени каталога: `YYYY-MM-DD`.
 * @param {string} iso момент времени ISO-8601
 * @returns {string}
 */
export declare function datePart(iso: string): string;
