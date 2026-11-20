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
export type PendingCycle = {
    /**
     * имя каталога цикла
     */
    name: string;
    /**
     * этап, на котором цикл остановился
     */
    stage: string;
    /**
     * статус этапа (`running`, `error`, …)
     */
    stage_status: string;
    /**
     * текущая итерация
     */
    iteration: number;
    /**
     * лимит итераций
     */
    max_iterations: number;
    /**
     * время последнего изменения состояния (ISO)
     */
    updated_at: string;
    /**
     * повторы
     */
    retries: {
        REVIEW: number;
        EVALUATE: number;
        evidence: number;
    };
};
export type StopGate = {
    id: string;
    status: 'fail' | 'not_run';
    /**
     * причина `not_run` (`no_database`, `tool_missing`, …)
     */
    reason: string | null;
};
export type StopCriterion = {
    id: string;
    /**
     * `partial`, `unmet` или `unverified`
     */
    status: string;
};
export type Stop = {
    /**
     * имя каталога цикла
     */
    name: string;
    /**
     * вердикт `decision.<n>.json` (`REWORK`, `ESCALATE`, …)
     */
    action: string | null;
    /**
     * причины решения, как их записал `cycle-decide`
     */
    reasons: string[];
    /**
     * непроверенное из решения
     */
    unverified: string[];
    escalation: {
        reason: string;
        detail: string | null;
    } | null;
    /**
     * критерии оценки, кроме `met`
     */
    criteria: StopCriterion[];
    /**
     * гейты последней итерации: `fail` и `not_run`
     */
    gates: StopGate[];
    /**
     * каких артефактов нет (`decision`, `escalation`, `gates`)
     */
    missing: string[];
    /**
     * данных не хватает, чтобы назвать причину
     */
    insufficient: boolean;
};
export type Report = {
    cycles: CycleSummary[];
    /**
     * каталоги со `state.json` без `metrics.json`
     */
    pending: PendingCycle[];
    /**
     * почему остановились циклы (завершённые и эскалированные)
     */
    stops: Stop[];
    /**
     * каталоги без `state.json` и без `metrics.json`
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
 * Подкаталоги каталога артефактов, отсортированные по имени: и циклы, и всё, что рядом с ними.
 * @param {string} dir каталог артефактов
 * @returns {string[]} имена каталогов
 */
export declare function listArtifactDirs(dir: string): string[];
/**
 * Каталоги циклов с `metrics.json` в каталоге артефактов, отсортированные по имени.
 * @param {string} dir каталог артефактов
 * @returns {string[]} имена каталогов
 */
export declare function listCycleDirs(dir: string): string[];
/**
 * Последний по номеру файл итерации `base.<n>.json` в каталоге цикла. Перебор каталога не
 * зависит от порядка `readdir`: выбирается максимум номера.
 * @param {string} cycleDir каталог цикла
 * @param {string} base имя без номера и расширения (`decision`, `gates`, `evaluation`)
 * @returns {{ iteration: number, fileName: string }|null}
 */
export declare function lastIterationFile(cycleDir: string, base: string): {
    iteration: number;
    fileName: string;
} | null;
/**
 * Сводка одного цикла: только поля, которые попадают в отчёт.
 * @param {string} name
 * @param {Record<string, any>} metrics
 * @returns {CycleSummary}
 */
export declare function summarizeCycle(name: string, metrics: Record<string, any>): CycleSummary;
/**
 * Сводка незавершённого цикла: только `state.json`, без вычислений и догадок.
 * @param {string} name имя каталога
 * @param {Record<string, any>} state проверенное состояние
 * @returns {PendingCycle}
 */
export declare function summarizePending(name: string, state: Record<string, any>): PendingCycle;
/**
 * Читает артефакты «почему встал» из каталога цикла. Критерии оценки берутся только из
 * `evaluation.<n>.json` той итерации, на которую ссылается решение: чужие критерии выдали бы
 * вердикт за свидетельство.
 * @param {string} cycleDir каталог цикла
 * @param {string} cycleName имя каталога цикла
 * @param {{ state?: Record<string, any>|null }} [options] уже прочитанное состояние
 * @returns {{
 *   decision: Record<string, any>|null,
 *   evaluation: Record<string, any>|null,
 *   escalation: Record<string, any>|null,
 *   gates: Record<string, any>|null,
 * }}
 */
export declare function collectStopArtifacts(cycleDir: string, cycleName: string, { state }?: {
    state?: Record<string, any> | null;
}): {
    decision: Record<string, any> | null;
    evaluation: Record<string, any> | null;
    escalation: Record<string, any> | null;
    gates: Record<string, any> | null;
};
/**
 * Причина остановки цикла. Чистая функция: файлов не читает.
 *
 * `insufficient` — не догадка, а факт «объяснять нечем»: нет ни решения, ни эскалации. Гейты
 * сами по себе остановку не объясняют (их `pass` — свидетельство проверки), поэтому в это
 * условие не входят.
 * @param {string} name имя каталога цикла
 * @param {ReturnType<typeof collectStopArtifacts>} artifacts
 * @returns {Stop}
 */
export declare function summarizeStop(name: string, artifacts: ReturnType<typeof collectStopArtifacts>): Stop;
/**
 * Исходы гейтов по всем циклам: суммы по `id`, порядок — таблица §5.5, затем алфавит.
 * @param {CycleSummary[]} cycles
 * @param {readonly string[]} [gateIds] порядок id из конфига проекта
 * @returns {Report['gates']}
 */
export declare function aggregateGates(cycles: CycleSummary[], gateIds?: readonly string[]): Report['gates'];
/**
 * Собирает отчёт из прочитанных артефактов. Чистая функция: файлов не читает.
 * @param {CycleSummary[]} cycles сводки по циклам (в порядке отчёта)
 * @param {{
 *   skipped?: number,
 *   gateIds?: readonly string[],
 *   pending?: PendingCycle[],
 *   stops?: Stop[],
 * }} [options]
 * @returns {Report}
 */
export declare function buildReport(cycles: CycleSummary[], { skipped, gateIds, pending, stops }?: {
    skipped?: number;
    gateIds?: readonly string[];
    pending?: PendingCycle[];
    stops?: Stop[];
}): Report;
/**
 * Отчёт в markdown: шапка с итогами, таблица циклов, таблица гейтов, незавершённые циклы
 * и причины остановки.
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
