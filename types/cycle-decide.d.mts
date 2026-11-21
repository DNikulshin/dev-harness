#!/usr/bin/env node
export type Retries = {
    /**
     * сколько раз уже повторяли ревью
     */
    REVIEW: number;
    /**
     * сколько раз уже повторяли оценку
     */
    EVALUATE: number;
    /**
     * сколько раз уже добирали свидетельства
     */
    evidence: number;
};
export type DecideInputs = {
    /**
     * номер итерации, целое ≥ 1
     */
    iteration: number;
    /**
     * `state.max_iterations`
     */
    maxIterations: number;
    /**
     * `state.retries`
     */
    retries: Retries;
    /**
     * проверенный `gates.<n>.json`
     */
    gates: {
        gates?: GateEntry[];
    };
    /**
     * проверенный блок ревью или `null`
     */
    review: Record<string, any> | null;
    /**
     * проверенный блок оценки или `null`
     */
    evaluation: Record<string, any> | null;
    /**
     *   проверенный `qa-web.json` или `null`, если файла нет
     */
    qaWeb: {
        status?: string;
        reason?: string | null;
        steps?: unknown[];
    } | null;
    /**
     * проверенный `evidence/integrity.json`
     * или `null` (по умолчанию): правил `integrity` в проекте нет или пакет собран без них
     */
    integrity?: Record<string, any> | null;
    /**
     * критерии из `evidence/criteria.md`, закреплённые `state.criteria_sha256`; `null`
     * (по умолчанию) — заморозки не было (старый цикл), сверять полноту не с чем
     */
    frozenCriteria?: readonly import('./lib/cycle/criteria.mjs').Criterion[] | null;
    /**
     * дифф затрагивает `apps/frontend`
     */
    webDiff: boolean;
    /**
     * корень репозитория для разрешения ссылок
     */
    root: string;
    /**
     * стоимость цикла по `usage.json` и `evals/prices.json`:
     * `null` (по умолчанию) — замера нет (нет `usage.json`, неизвестна модель или цены),
     * и тогда бюджетный порог не проверяется: ноль был бы выдуманными данными
     */
    costRub?: number | null;
    /**
     * сообщения валидаторов по этапам
     * (`REVIEW`/`EVALUATE`): из них строятся подсказки `invalid:<STAGE> …`
     */
    agentErrors?: Record<string, string[]>;
    /**
     * лимиты проекта (по умолчанию из DEFAULTS)
     */
    limits?: {
        maxCycleCostRub: number;
    };
    /**
     * применённые
     * лимиты с источниками для `decision.applied_limits`; считает CLI, а не эта функция
     */
    appliedLimits?: Record<string, {
        value: number;
        source: import('./lib/cycle/limits.mjs').LimitSource;
    }>;
};
export type GateEntry = {
    id?: string;
    required?: boolean;
    status?: string;
    /**
     * причина `not_run`/`fail` (§5.5), `null` — без причины
     */
    reason?: string | null;
};
export type DecisionCounts = {
    blockers: number;
    major: number;
    minor: number;
    followups: number;
    partial_criteria: number;
    verdict_without_evidence: number;
};
export type Decision = {
    iteration: number;
    action: 'REWORK' | 'ACQUIRE_EVIDENCE' | 'RETRY_STAGE' | 'PROCEED' | 'PROCEED_WITH_UNVERIFIED' | 'ESCALATE';
    retry_stage: 'REVIEW' | 'EVALUATE' | null;
    acquire: string[];
    reasons: string[];
    rework_items: string[];
    unverified: string[];
    downgraded: string[];
    counts: DecisionCounts;
    /**
     * лимиты и их источники
     */
    applied_limits?: Record<string, {
        value: number;
        source: import('./lib/cycle/limits.mjs').LimitSource;
    }>;
    unresolved_refs: number;
};
/**
 * @typedef {object} Retries
 * @property {number} REVIEW сколько раз уже повторяли ревью
 * @property {number} EVALUATE сколько раз уже повторяли оценку
 * @property {number} evidence сколько раз уже добирали свидетельства
 */
/**
 * @typedef {object} DecideInputs
 * @property {number} iteration номер итерации, целое ≥ 1
 * @property {number} maxIterations `state.max_iterations`
 * @property {Retries} retries `state.retries`
 * @property {{ gates?: GateEntry[] }} gates проверенный `gates.<n>.json`
 * @property {Record<string, any>|null} review проверенный блок ревью или `null`
 * @property {Record<string, any>|null} evaluation проверенный блок оценки или `null`
 * @property {{ status?: string, reason?: string|null, steps?: unknown[] }|null} qaWeb
 *   проверенный `qa-web.json` или `null`, если файла нет
 * @property {Record<string, any>|null} [integrity] проверенный `evidence/integrity.json`
 *   или `null` (по умолчанию): правил `integrity` в проекте нет или пакет собран без них
 * @property {readonly import('./lib/cycle/criteria.mjs').Criterion[]|null} [frozenCriteria]
 *   критерии из `evidence/criteria.md`, закреплённые `state.criteria_sha256`; `null`
 *   (по умолчанию) — заморозки не было (старый цикл), сверять полноту не с чем
 * @property {boolean} webDiff дифф затрагивает `apps/frontend`
 * @property {string} root корень репозитория для разрешения ссылок
 * @property {number|null} [costRub] стоимость цикла по `usage.json` и `evals/prices.json`:
 *   `null` (по умолчанию) — замера нет (нет `usage.json`, неизвестна модель или цены),
 *   и тогда бюджетный порог не проверяется: ноль был бы выдуманными данными
 * @property {Record<string, string[]>} [agentErrors] сообщения валидаторов по этапам
 *   (`REVIEW`/`EVALUATE`): из них строятся подсказки `invalid:<STAGE> …`
 * @property {{ maxCycleCostRub: number }} [limits] лимиты проекта (по умолчанию из DEFAULTS)
 * @property {Record<string, { value: number, source: import('./lib/cycle/limits.mjs').LimitSource }>} [appliedLimits] применённые
 *   лимиты с источниками для `decision.applied_limits`; считает CLI, а не эта функция
 */
/**
 * Запись гейта в `gates.<n>.json` в объёме, нужном решению. Поля необязательны: чистая
 * функция не полагается на валидатор и допускает частичный документ.
 * @typedef {object} GateEntry
 * @property {string} [id]
 * @property {boolean} [required]
 * @property {string} [status]
 * @property {string|null} [reason] причина `not_run`/`fail` (§5.5), `null` — без причины
 */
/**
 * Счётчики решения (§5.6): то, что попадает в `decision.<n>.json` и метрики.
 * @typedef {object} DecisionCounts
 * @property {number} blockers
 * @property {number} major
 * @property {number} minor
 * @property {number} followups
 * @property {number} partial_criteria
 * @property {number} verdict_without_evidence
 */
/**
 * @typedef {object} Decision
 * @property {number} iteration
 * @property {'REWORK'|'ACQUIRE_EVIDENCE'|'RETRY_STAGE'|'PROCEED'|'PROCEED_WITH_UNVERIFIED'|'ESCALATE'} action
 * @property {'REVIEW'|'EVALUATE'|null} retry_stage
 * @property {string[]} acquire
 * @property {string[]} reasons
 * @property {string[]} rework_items
 * @property {string[]} unverified
 * @property {string[]} downgraded
 * @property {DecisionCounts} counts
 * @property {Record<string, { value: number, source: import('./lib/cycle/limits.mjs').LimitSource }>} [applied_limits] лимиты и их источники
 * @property {number} unresolved_refs
 */
/**
 * Глубокая сортировка ключей: массивы сохраняют порядок, примитивы не меняются.
 * Нужна, чтобы файл решения не зависел от порядка ключей объектов входа (D4,
 * требование детерминизма §5.6/§5.10).
 * @param {unknown} value
 * @returns {unknown}
 */
export declare function normalizeDoc(value: unknown): unknown;
/**
 * Затрагивает ли дифф web-приложение: от этого зависит необходимость QA_WEB (§5.6, п. 4).
 * Префиксы путей — свойство проекта (`qaWeb.pathPrefixes` в `.pi/harness.config.json`);
 * пустой список означает «проект не просит браузерную проверку». Список файлов берётся из
 * `git.changedFiles`, поэтому untracked видны только после `git add --intent-to-add`
 * (протокол Приложения B).
 * @param {string[]} files пути относительно корня репозитория
 * @param {readonly string[]} [prefixes] префиксы путей web-приложения
 * @returns {boolean}
 */
export declare function diffTouchesWeb(files: string[], prefixes?: readonly string[]): boolean;
/**
 * Факты контроля целостности проверок (#36) → строки `unverified[]` и признак добора.
 * Правило узкое и фактическое: ядро не судит, ослаблены ли тесты, оно фиксирует, что
 * изменилось. Правка защищённого файла (любой статус) и удаление теста — повод добрать
 * свидетельства (`acquire: integrity`); правка тестов под задачу — только отметка, иначе
 * каждый цикл с новыми тестами терял бы `PROCEED` и владелец получал бы чекбоксы на
 * нормальной работе.
 * @param {Record<string, any>|null|undefined} integrity проверенный документ или `null`
 * @returns {{ unverified: string[], acquires: boolean }}
 */
export declare function integritySignals(integrity: Record<string, any> | null | undefined): {
    unverified: string[];
    acquires: boolean;
};
/**
 * Расчёт решения цикла. Чистая функция: файлов не читает и не пишет, время и
 * случайность не использует — на одних и тех же входах результат совпадает.
 * @param {DecideInputs} inputs
 * @returns {Decision}
 */
export declare function decide(inputs: DecideInputs): Decision;
