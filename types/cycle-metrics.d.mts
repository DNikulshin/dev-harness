#!/usr/bin/env node
import { loadConfig } from './lib/cycle/config.mjs';
/**
 * Стоимость и расход: те же функции, что у бюджетного порога `cycle-decide` —
 * реэкспорт ради тестов и внешних читателей. Источник истины — `lib/cycle/cost.mjs`.
 */
export { normalizeUsage, priceKeyFor, priceUsage } from './lib/cycle/cost.mjs';
/** Допуск сопоставления находок в строках (§5.6). */
export declare const LINE_TOLERANCE = 5;
export type IterationInputs = {
    /**
     * номер итерации, целое ≥ 1
     */
    iteration: number;
    /**
     * проверенный `gates.<n>.json`
     */
    gates: Record<string, any>;
    /**
     * проверенный `review.<n>.json` или `null`
     */
    review: Record<string, any> | null;
    /**
     * проверенный `evaluation.<n>.json` или `null`
     */
    evaluation: Record<string, any> | null;
    /**
     * проверенный `decision.<n>.json` или `null`
     */
    decision: Record<string, any> | null;
};
export type Metrics = {
    iterations: number;
    max_iterations: number;
    final_stage: string;
    stage_durations_s: Record<string, number>;
    cycle_duration_s: number;
    gate_durations_s: Record<string, number>;
    gate_total_s: number;
    gate_outcomes: Record<string, Record<string, number>>;
    review_findings: Record<string, number>;
    evaluator_defects: Record<string, number>;
    only_review: number;
    only_evaluator: number;
    both: number;
    unresolved_refs: number;
    verdict_without_evidence: number;
    unclosed_stages: number;
    evaluator_shares_family_with_plan: boolean;
    tokens: Record<string, {
        runs: number;
        input: number;
        cache_read: number;
        cache_write: number;
        output: number;
        reasoning: number;
    }> | null;
    cost_rub: number | null;
    driver?: {
        steps: number;
        executed: number;
        handed_off: number;
        mismatch: number;
    };
};
/**
 * Сопоставление находок ревью с дефектами оценщика (§5.6, «совпали»). Чистая функция:
 * порядок обхода фиксирован — находки в порядке следования, к каждой берётся первый
 * ещё не занятый дефект. Каждый элемент участвует не больше одного раза, поэтому
 * `both + only_review` равно числу находок, а `both + only_evaluator` — числу дефектов.
 * @param {unknown} [review] проверенный `review.<n>.json`, `null` или отсутствующий
 * @param {unknown} [evaluation] проверенный `evaluation.<n>.json`, `null` или отсутствующий
 * @returns {{ only_review: number, only_evaluator: number, both: number }}
 */
export declare function matchFindings(review?: unknown, evaluation?: unknown): {
    only_review: number;
    only_evaluator: number;
    both: number;
};
/**
 * Оценщик в одном семействе с планом (предупреждение о потере независимости).
 *
 * Значение `true` означает «в том же семействе или это неизвестно»: метрика должна
 * предупреждать, а не успокаивать, поэтому неопределённость трактуется как совпадение.
 * Ключа `evaluate` в `state.models` до T7 нет (агент появится в T7), и по R2 в этом
 * случае возвращается `true` — иначе отсутствие данных читалось бы как подтверждённая
 * независимость. По той же причине не сравнивается `review`: пока оценивает ревьюер,
 * вопрос «оценщик против плана» ещё не имеет ответа.
 * @param {unknown} models `state.models`
 * @returns {boolean}
 */
export declare function evaluatorSharesFamilyWithPlan(models: unknown): boolean;
/**
 * Считает метрики цикла. Чистая функция: файлов не читает и не пишет, время и
 * случайность не использует — на одних и тех же входах результат совпадает.
 *
 * Ожидает уже проверенные валидаторами документы, но не полагается на это: битая дата,
 * отрицательная или нечисловая длительность и нечисловые счётчики — исключение с
 * указанием записи (`state.history[i]`, `gates.<n>`), а не тихий ноль.
 * Токены и стоимость считаются только из переданных фактов: `usage` и `prices`.
 * `null` в обоих означает «замера нет», и это не то же самое, что ноль.
 * @param {{
 *   state: Record<string, any>,
 *   iterations: IterationInputs[],
 *   usage?: Record<string, any>|null,
 *   prices?: Record<string, import('./lib/evals/cost.mjs').ModelPrice>|null,
 *   appliedLimits?: Record<string, { value: number, source: string }>|null,
 *   driver?: { steps: number, executed: number, handed_off: number, mismatch: number }|null,
 * }} inputs
 *   `appliedLimits` — лимиты с источниками (#235): попав в `metrics.json`, они объясняют,
 *   по какому порогу считались бюджет и размер диффа. Считает CLI, а не эта функция.
 *   `driver` — сводка журнала `driver.jsonl` (#47): сколько шагов выдал драйвер, сколько
 *   исполнил сам и сколько раз состояние разошлось с его ответом. `null` — журнала нет.
 * @returns {Metrics}
 */
export declare function buildMetrics({ state, iterations, usage, prices, appliedLimits, driver, }: {
    state: Record<string, any>;
    iterations: IterationInputs[];
    usage?: Record<string, any> | null;
    prices?: Record<string, import('./lib/evals/cost.mjs').ModelPrice> | null;
    appliedLimits?: Record<string, {
        value: number;
        source: string;
    }> | null;
    driver?: {
        steps: number;
        executed: number;
        handed_off: number;
        mismatch: number;
    } | null;
}): Metrics;
/**
 * Разбирает аргументы командной строки. Любой мусор — ошибка использования (код 2).
 * @param {string[]} argv
 * @returns {{ dir: string|null }}
 */
export declare function parseArgs(argv: string[]): {
    dir: string | null;
};
/**
 * Сводка журнала решений драйвера (#47). Нет файла — `null`: цикл вели без драйвера, и это
 * факт, а не ноль. Битая запись — исключение (код 2), а не тихий пропуск: `mismatch`
 * считается по журналу, и потерянная строка выдала бы себя за чистую маршрутизацию.
 * @param {string} dir каталог цикла
 * @returns {{ steps: number, executed: number, handed_off: number, mismatch: number }|null}
 */
export declare function readDriverJournal(dir: string): {
    steps: number;
    executed: number;
    handed_off: number;
    mismatch: number;
} | null;
/**
 * Каталог цикла при запуске без `--dir`. Сообщение `findActiveCycle` содержит
 * абсолютный путь каталога артефактов; для диагностики он заменяется относительным.
 * @param {string} root корень репозитория
 * @param {ReturnType<typeof loadConfig>} [config] конфиг проекта
 * @returns {string} путь к каталогу активного цикла
 */
export declare function resolveCycleDir(root: string, config?: ReturnType<typeof loadConfig>): string;
