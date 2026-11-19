export type ScoredStage = 'review' | 'evaluate';
/**
 * Стадия, по которой считается прогон сида.
 * @typedef {'review'|'evaluate'} ScoredStage
 */
/** Этапы, которые участвуют в прогонах сидов: `code` не запускается (§15). */
export declare const SCORED_STAGES: readonly ScoredStage[];
/** Итог прогона по сиду. `invalid` — ответ не разобрался, его нельзя считать ни попаданием, ни промахом. */
export declare const RUN_STATUSES: readonly string[];
/**
 * Все блоки `json` из markdown, в порядке появления. Блок с битым JSON пропускается:
 * агент мог показать пример схемы, а не результат.
 * @param {unknown} markdown ответ агента (нестрока — пустой список блоков)
 * @returns {unknown[]}
 */
export declare function extractJsonBlocks(markdown: unknown): unknown[];
/**
 * Результат ответа этапа: последний блок, прошедший схему Приложения A.
 * @param {unknown} markdown ответ агента целиком
 * @param {'review'|'evaluate'} stage
 * @returns {{ ok: true, doc: Record<string, any> } | { ok: false, reason: string }}
 */
export declare function readStageResult(markdown: unknown, stage: 'review' | 'evaluate'): {
    ok: true;
    doc: Record<string, any>;
} | {
    ok: false;
    reason: string;
};
/**
 * Позиции всех находок ответа в нормализованном виде.
 * @param {'review'|'evaluate'} stage
 * @param {unknown} doc ответ агента (форма проверяется здесь, а не вызывающим)
 * @returns {{ file: string, line: number, severity: string }[]}
 */
export declare function positionsOf(stage: 'review' | 'evaluate', doc: unknown): {
    file: string;
    line: number;
    severity: string;
}[];
/**
 * Скоринг одного прогона.
 *
 * Для сида-дефекта попаданием считается находка серьёзности не ниже ожидаемой в том же
 * файле и в пределах допуска по строке. Если у сида строка не задана, достаточно файла.
 * Для чистого сида любая находка `BLOCKER`/`MAJOR` — ложная блокировка.
 * @param {{ expect: import('./seeds.mjs').SeedExpectation }} seed ожидание сида
 *   (полный `Seed` не нужен: читается только `expect`)
 * @param {'review'|'evaluate'} stage
 * @param {string} markdown ответ агента
 * @returns {{ status: string, reason: string }}
 */
export declare function scoreRun(seed: {
    expect: import('./seeds.mjs').SeedExpectation;
}, stage: 'review' | 'evaluate', markdown: string): {
    status: string;
    reason: string;
};
/**
 * Свод по прогонам.
 *
 * Прогоны группируются по конфигурации, внутри — по сиду и этапу. По сиду считается
 * объединение этапов (union), как в §15: полнота меряется на «поймал хоть кто-то»,
 * а раздельно этапы нужны, чтобы увидеть, окупается ли каждый из них.
 *
 * Сид-дефект без единого попадания — промах; сид, где все ответы не разобрались, —
 * не промах и не попадание: он выпадает из полноты, но виден в `counts.invalid`.
 * @param {{
 *   runs: Array<{ config: string, seed: string, stage: string, status: string, reason?: string, cost_rub?: number|null }>,
 *   seeds: Record<string, 'clean'|'defect'>,
 *   thresholds: { completeness: number, false_positive_max: number },
 * }} input
 * @returns {Record<string, any>} отчёт
 */
export declare function buildReport({ runs, seeds, thresholds }: {
    runs: Array<{
        config: string;
        seed: string;
        stage: string;
        status: string;
        reason?: string;
        cost_rub?: number | null;
    }>;
    seeds: Record<string, 'clean' | 'defect'>;
    thresholds: {
        completeness: number;
        false_positive_max: number;
    };
}): Record<string, any>;
