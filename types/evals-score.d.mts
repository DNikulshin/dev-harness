#!/usr/bin/env node
/** Пороги по умолчанию (docs/orchestrator.md §15: полнота ≥ 0.8, ложные блокировки ≤ 1 из 5). */
export declare const DEFAULT_THRESHOLDS: Readonly<{
    completeness: 0.8;
    false_positive_max: 0.2;
}>;
/**
 * Разбирает аргументы командной строки.
 * @param {string[]} argv
 * @returns {{ runs: string|null, seeds: string|null, prices: string|null, root: string|null, completeness: number, falsePositiveMax: number }}
 */
export declare function parseArgs(argv: string[]): {
    runs: string | null;
    seeds: string | null;
    prices: string | null;
    root: string | null;
    completeness: number;
    falsePositiveMax: number;
};
/**
 * Каталоги прогонов: подкаталоги с `meta.json`, упорядоченные по имени.
 * @param {string} dir
 * @returns {string[]}
 */
export declare function findRuns(dir: string): string[];
/**
 * План повторов из `meta.json`.
 *
 * Старые каталоги поля не имеют и читаются как один повтор — иначе ретроспективные
 * отчёты пришлось бы переписывать. Мусор в поле — ошибка данных: молчаливое «пусть
 * будет один» скрыло бы прогон, который никто не повторял.
 * @param {Record<string, any>} meta
 * @param {string} label имя каталога прогона для сообщения
 * @returns {number}
 */
export declare function repeatOf(meta: Record<string, any>, label: string): number;
/**
 * Отчёт в markdown: его прикладывают к issue и читают без запуска скриптов.
 * @param {Record<string, any>} report
 * @param {Array<Record<string, any>>} runs сырые прогоны: в них есть причины, которых нет в своде
 * @param {string[]} skipped
 * @returns {string}
 */
export declare function renderMarkdown(report: Record<string, any>, runs: Array<Record<string, any>>, skipped: string[]): string;
