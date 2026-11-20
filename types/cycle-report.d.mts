#!/usr/bin/env node
export type CycleSummary = {
    /**
     * имя каталога цикла
     */
    name: string;
    /**
     * `final_stage` из `metrics.json`
     */
    final_stage: string;
    iterations: number;
    max_iterations: number;
    duration_s: number;
    /**
     * расход или `null`, если замера нет
     */
    cost_rub: number | null;
    findings: {
        only_review: number;
        only_evaluator: number;
        both: number;
    };
    evaluator_defects: Record<string, number>;
    review_findings: Record<string, number>;
    unresolved_refs: number;
    unclosed_stages: number;
    gate_outcomes: Record<string, Record<string, number>>;
};
export type Report = {
    cycles: CycleSummary[];
    /**
     * каталоги без `metrics.json`
     */
    skipped: number;
    cost: {
        measured: number;
        total: number;
        sum: number | null;
        median: number | null;
    };
    findings: {
        evaluator_only: number;
        total: number;
        percent: number | null;
    };
    gates: {
        id: string;
        pass: number;
        fail: number;
        skipped: number;
        not_run: number;
    }[];
};
/**
 * Медиана чисел; `null` для пустого списка. Для чётного числа — среднее двух средних
 * (так же считается `alert = 2 × медиана` в §11).
 * @param {unknown} values список чисел (не массив или пустой — `null`)
 * @returns {number|null}
 */
export declare function median(values: unknown): number | null;
/**
 * Процент от целого: `null`, если делить не на что. Одна цифра после запятой.
 * @param {number} part
 * @param {number} total
 * @returns {number|null}
 */
export declare function percent(part: number, total: number): number | null;
/**
 * Каталоги циклов с `metrics.json` в каталоге артефактов, отсортированные по имени.
 * @param {string} dir каталог артефактов
 * @returns {string[]} имена каталогов
 */
export declare function listCycleDirs(dir: string): string[];
/**
 * Сводка одного цикла: только поля, которые попадают в отчёт.
 * @param {string} name
 * @param {Record<string, any>} metrics
 * @returns {CycleSummary}
 */
export declare function summarizeCycle(name: string, metrics: Record<string, any>): CycleSummary;
/**
 * Исходы гейтов по всем циклам: суммы по `id`, порядок — таблица §5.5, затем алфавит.
 * @param {CycleSummary[]} cycles
 * @param {readonly string[]} [gateIds] порядок id из конфига проекта
 * @returns {Report['gates']}
 */
export declare function aggregateGates(cycles: CycleSummary[], gateIds?: readonly string[]): Report['gates'];
/**
 * Собирает отчёт из прочитанных метрик. Чистая функция: файлов не читает.
 * @param {CycleSummary[]} cycles сводки по циклам (в порядке отчёта)
 * @param {{ skipped?: number, gateIds?: readonly string[] }} [options]
 * @returns {Report}
 */
export declare function buildReport(cycles: CycleSummary[], { skipped, gateIds }?: {
    skipped?: number;
    gateIds?: readonly string[];
}): Report;
/**
 * Отчёт в markdown: шапка с итогами, таблица циклов, таблица гейтов.
 * @param {Report} report
 * @returns {string}
 */
export declare function renderMarkdown(report: Report): string;
/**
 * Экранирует текст для HTML. Имена каталогов циклов и id гейтов приходят из файловой системы
 * и конфига проекта, то есть в общем случае недоверенные.
 * @param {unknown} value
 * @returns {string}
 */
export declare function escapeHtml(value: unknown): string;
/**
 * Доля от максимума в процентах — для ширины полоски расхода. Детерминированно: округление
 * до десятых, ноль знаменателя — ноль ширины.
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
export declare function barPercent(value: number, max: number): number;
/**
 * Отчёт одной самодостаточной HTML-страницей (#45). Чистая функция: те же факты, что в
 * markdown, без времени, случайности и внешних ресурсов.
 * @param {Report} report
 * @returns {string}
 */
export declare function renderHtml(report: Report): string;
/**
 * Разбирает аргументы командной строки. Любой мусор — ошибка использования (код 2).
 * @param {string[]} argv
 * @returns {{ dir: string|null, json: boolean, html: boolean }}
 */
export declare function parseArgs(argv: string[]): {
    dir: string | null;
    json: boolean;
    html: boolean;
};
