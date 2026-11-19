#!/usr/bin/env node
/**
 * Разбирает аргументы командной строки.
 * @param {string[]} argv
 * @returns {{ run: string|null, stage: string|null, transcript: string|null, out: string|null, root: string|null }}
 */
export declare function parseArgs(argv: string[]): {
    run: string | null;
    stage: string | null;
    transcript: string | null;
    out: string | null;
    root: string | null;
};
