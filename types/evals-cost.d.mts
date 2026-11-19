#!/usr/bin/env node
/**
 * Разбирает аргументы командной строки. Мусор — ошибка использования (код 2).
 * @param {string[]} argv
 * @returns {{
 *   root: string|null,
 *   prices: string|null,
 *   profiles: string|null,
 *   candidates: string|null,
 *   models: string[],
 *   json: boolean,
 * }}
 */
export declare function parseArgs(argv: string[]): {
    root: string | null;
    prices: string | null;
    profiles: string | null;
    candidates: string | null;
    models: string[];
    json: boolean;
};
