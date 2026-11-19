#!/usr/bin/env node
/** Этапы, на которых вызывается модель. `GATES`/`QA_WEB` — процессы, а не токены. */
export declare const USAGE_STAGES: readonly string[];
/**
 * Разбирает аргументы командной строки.
 * @param {string[]} argv
 * @returns {{ dir: string|null, stage: string|null, transcript: string|null, root: string|null }}
 */
export declare function parseArgs(argv: string[]): {
    dir: string | null;
    stage: string | null;
    transcript: string | null;
    root: string | null;
};
/**
 * Дописывает расход одного прогона в карту этапов.
 *
 * Чистая функция: не читает и не пишет файлы — её проверяют тесты без фикстур
 * и без транскриптов.
 * @param {Record<string, any>|null} previous прежнее содержимое `usage.json` или `null`
 * @param {string} stage этап из `USAGE_STAGES`
 * @param {{ input: number, cache_read: number, cache_write: number, output: number, reasoning: number }} run расход прогона
 * @returns {Record<string, any>} новая карта, прежняя не меняется
 */
export declare function addStageUsage(previous: Record<string, any> | null, stage: string, run: {
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
    reasoning: number;
}): Record<string, any>;
