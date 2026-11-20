#!/usr/bin/env node
/**
 * Разбирает аргументы командной строки.
 * @param {string[]} argv
 * @returns {{ seed: string|null, candidate: string, out: string|null, now: string|null, repeat: number, force: boolean, root: string|null }}
 */
export declare function parseArgs(argv: string[]): {
    seed: string | null;
    candidate: string;
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
/**
 * Ожидание сида одной строкой: набор `severities` печатается набором, а не одним значением,
 * иначе сид с `MAJOR|FOLLOW-UP` выглядел бы как требование `BLOCKER`.
 * @param {import('./lib/evals/seeds.mjs').SeedExpectation} expect
 * @returns {string}
 */
export declare function describeExpectation(expect: import('./lib/evals/seeds.mjs').SeedExpectation): string;
