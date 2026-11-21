#!/usr/bin/env node
/** Ошибка использования или внутренняя: код 2. */
export declare class UsageError extends Error {
}
/** Конфликт состояния: код 3. */
export declare class ConflictError extends Error {
}
/**
 * Таблица допустимых переходов §5.3. `DONE` и `ESCALATED` терминальны — ключей нет.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export declare const TRANSITIONS: Readonly<Record<string, readonly string[]>>;
/**
 * Разрешён ли переход по таблице §5.3 (включая переходы в `ESCALATED`).
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export declare function canTransition(from: string, to: string): boolean;
/**
 * Цели `advance` из этапа: таблица без `ESCALATED` — эскалация только подкомандой
 * `escalate` (у неё свои защиты и `escalation.json`).
 * @param {string} from
 * @returns {string[]}
 */
export declare function advanceTargets(from: string): string[];
/**
 * Начало этапа: открытая запись в `history[]` и `stage_status = 'running'`.
 * Чистая функция — время приходит параметром `now`.
 * @param {Record<string, any>} state проверенное состояние
 * @param {{ stage: string, iteration?: number, now: string }} options
 * @returns {Record<string, any>} новое состояние
 */
export declare function startStage(state: Record<string, any>, { stage, iteration, now }: {
    stage: string;
    iteration?: number;
    now: string;
}): Record<string, any>;
/**
 * Переход `advance --to STAGE` с защитами §5.3. Возвращает новое состояние или бросает
 * `ConflictError` (код 3); файл не меняется, вызывающий пишет только после валидации.
 * @param {Record<string, any>} state проверенное состояние
 * @param {{
 *   to: string,
 *   now: string,
 *   ownerApproved?: boolean,
 *   artifacts?: { hasReview?: boolean, hasEvaluation?: boolean, decision?: Record<string, any>|null },
 * }} options
 *   `artifacts` — предусловия этапа, собранные вызывающим из каталога цикла: наличие
 *   `review.<n>.md`/`evaluation.<n>.md` для `→ DECIDE` и решение с `PROCEED*` для `→ PR`.
 * @returns {Record<string, any>} новое состояние
 */
export declare function advanceTo(state: Record<string, any>, { to, now, ownerApproved, artifacts }: {
    to: string;
    now: string;
    ownerApproved?: boolean;
    artifacts?: {
        hasReview?: boolean;
        hasEvaluation?: boolean;
        decision?: Record<string, any> | null;
    };
}): Record<string, any>;
/**
 * Закрытие этапа `finish --stage STAGE --status done|error`.
 * @param {Record<string, any>} state проверенное состояние
 * @param {{ stage: string, status: 'done'|'error', detail?: string|null, now: string }} options
 * @returns {Record<string, any>} новое состояние
 */
export declare function finishStage(state: Record<string, any>, { stage, status, detail, now }: {
    stage: string;
    status: 'done' | 'error';
    detail?: string | null;
    now: string;
}): Record<string, any>;
/**
 * Начальное состояние цикла (`init`). INIT сразу закрыт как `done`: в протоколе
 * Приложения B у INIT нет `finish`.
 * @param {{
 *   issue: number,
 *   slug: string,
 *   branch: string,
 *   baseSha: string,
 *   models: Record<string, string>,
 *   now: string,
 *   maxIterations?: number,
 * }} options
 * @returns {Record<string, any>}
 */
export declare function buildInitState({ issue, slug, branch, baseSha, models, now, maxIterations, }: {
    issue: number;
    slug: string;
    branch: string;
    baseSha: string;
    models: Record<string, string>;
    now: string;
    maxIterations?: number;
}): Record<string, any>;
/**
 * `sha256` канонического JSON решения: `normalizeDoc` сортирует ключи, поэтому digest
 * не зависит от порядка полей в `decision.<n>.json` и файл остаётся побайтно
 * воспроизводимым.
 * @param {Record<string, any>} decision проверенное решение
 * @returns {string} hex-дайджест
 */
export declare function decisionDigest(decision: Record<string, any>): string;
/**
 * Маркер применённого решения (`applied_decision`). Сравнивается по четырём полям:
 * `iteration`, `action`, `retry_stage` и `digest` (содержимое решения целиком). Повторный
 * запуск `apply-decision` с тем же решением — no-op, с изменённым — применяется заново.
 * @param {Record<string, any>} decision проверенное решение
 * @returns {{ iteration: number, action: string, retry_stage: string|null, digest: string }}
 */
export declare function decisionMarker(decision: Record<string, any>): {
    iteration: number;
    action: string;
    retry_stage: string | null;
    digest: string;
};
/**
 * Совпадает ли записанный маркер с текущим решением (идемпотентность `apply-decision`).
 * Нет `digest` (старый маркер) — не совпадает: решение применяется заново.
 * @param {unknown} applied значение `state.applied_decision`
 * @param {{ iteration: number, action: string, retry_stage: string|null, digest: string }} marker
 * @returns {boolean}
 */
export declare function markerMatches(applied: unknown, marker: {
    iteration: number;
    action: string;
    retry_stage: string | null;
    digest: string;
}): boolean;
/**
 * Применение решения `decision.<n>.json` к состоянию (`apply-decision`).
 *
 * Счётчики: `RETRY_STAGE` → `retries[stage]++`, `ACQUIRE_EVIDENCE` → `retries.evidence++`,
 * `REWORK` → переход в REWORK без изменения `iteration` (инкремент — на ребре
 * `REWORK → CODE`, уточнение супервизора §6), `PROCEED*` → PR, `ESCALATE` → `escalate`.
 * @param {Record<string, any>} state проверенное состояние
 * @param {{
 *   decision: Record<string, any>,
 *   now: string,
 *   escalation?: Record<string, any>|null,
 * }} options `escalation` — документ эскалации для action = ESCALATE
 * @returns {Record<string, any>} новое состояние
 */
export declare function applyDecisionToState(state: Record<string, any>, { decision, now, escalation }: {
    decision: Record<string, any>;
    now: string;
    escalation?: Record<string, any> | null;
}): Record<string, any>;
/**
 * Завершён ли проход `code`: последняя запись `history` со `stage = CODE` имеет `done`.
 * @param {Record<string, any>[]} history
 * @returns {boolean}
 */
export declare function codePassDone(history: Record<string, any>[]): boolean;
/**
 * Все ли обязательные гейты зелёные (условие draft PR, §9 спеки). Fail-safe: невалидный
 * документ, чужая/неизвестная итерация и отсутствие обязательных гейтов — `false`
 * (неполные данные — не повод открывать draft PR).
 * @param {unknown} gatesDoc разобранный `gates.<n>.json` или `null`
 * @param {number} iteration итерация состояния: документ обязан относиться к ней
 * @returns {boolean}
 */
export declare function mandatoryGatesGreen(gatesDoc: unknown, iteration: number): boolean;
/**
 * Условие draft PR (§5.3, R4, §9 спеки): проход `code` завершён, обязательные гейты
 * зелёные (`mandatoryGatesGreen`) и причина из списка
 * `iteration_limit`/`budget`/`agent_output_invalid`.
 * @param {{ reason: string, codePassDone: boolean, gatesOk: boolean }} options
 * @returns {boolean}
 */
export declare function draftPrAllowed({ reason, codePassDone: passDone, gatesOk }: {
    reason: string;
    codePassDone: boolean;
    gatesOk: boolean;
}): boolean;
/**
 * Документ `escalation.json` (Приложение A). `detail` маскируется (§5.4), `open_items`
 * приходят из решения текущей итерации.
 * @param {{
 *   reason: string,
 *   detail?: string|null,
 *   codePassDone?: boolean,
 *   gatesOk?: boolean,
 *   openItems?: string[],
 * }} options
 * @returns {Record<string, any>}
 */
export declare function buildEscalation({ reason, detail, codePassDone: passDone, gatesOk, openItems, }: {
    reason: string;
    detail?: string | null;
    codePassDone?: boolean;
    gatesOk?: boolean;
    openItems?: string[];
}): Record<string, any>;
/**
 * Проверяет причину эскалации по словарю D7 через валидатор `escalation.json` — списка
 * причин в этом модуле нет, источник истины один (`validate.mjs`).
 * @param {unknown} reason
 * @returns {boolean}
 */
export declare function isValidEscalationReason(reason: unknown): boolean;
/**
 * Причина эскалации из решения (`reasons[]` вида `escalate:<reason>`, §5.6). Неизвестная
 * причина — `internal_error`: эскалация не должна терять факт блокировки.
 * @param {Record<string, any>} decision
 * @returns {string}
 */
export declare function escalationReasonFromDecision(decision: Record<string, any>): string;
/**
 * Переход в ESCALATED (`escalate` и `apply-decision` с ESCALATE): открытая запись
 * закрывается `error`, документ эскалации пишется вызывающим.
 * @param {Record<string, any>} state проверенное состояние
 * @param {{ escalation: Record<string, any>, now: string }} options
 * @returns {Record<string, any>} новое состояние
 */
export declare function escalateToState(state: Record<string, any>, { escalation, now }: {
    escalation: Record<string, any>;
    now: string;
}): Record<string, any>;
/**
 * Куда возобновлять цикл (`resume`, §13). Смотрим актуальную попытку текущего этапа —
 * последнюю запись `history` с `stage = state.stage` (записей нет — `stage_status`), — а не
 * первую незакрытую запись: иначе старая `error` после успешного повторного прохода
 * возвращала бы `continue` для уже завершённого этапа.
 *
 * - `running` → `continue`, `allowed_next: []` (сначала `finish`);
 * - `error` → `continue`, `allowed_next: [state.stage]` (повторный вход в тот же этап
 *   разрешён `advance`);
 * - `done` → `advance` и цели из таблицы §5.3.
 *
 * Терминальные этапы — код 3.
 * @param {Record<string, any>} state проверенное состояние
 * @returns {{ action: 'continue'|'advance', allowed_next: string[] }}
 */
export declare function resumeTarget(state: Record<string, any>): {
    action: 'continue' | 'advance';
    allowed_next: string[];
};
/**
 * Разбирает аргументы командной строки. Неизвестная подкоманда, чужой флаг, отсутствующее
 * значение и мусор в типизированных флагах — ошибка использования (код 2).
 * @param {string[]} argv аргументы без `node` и имени скрипта
 * @returns {{
 *   command: string,
 *   dir: string|null,
 *   field: string|null,
 *   to: string|null,
 *   stage: string|null,
 *   status: 'done'|'error'|null,
 *   detail: string|null,
 *   reason: string|null,
 *   issue: number|null,
 *   slug: string|null,
 *   branch: string|null,
 *   date: string|null,
 *   maxIterations: number|null,
 *   ownerApproved: boolean,
 *   now: string|null,
 * }}
 */
export declare function parseArgs(argv: string[]): {
    command: string;
    dir: string | null;
    field: string | null;
    to: string | null;
    stage: string | null;
    status: 'done' | 'error' | null;
    detail: string | null;
    reason: string | null;
    issue: number | null;
    slug: string | null;
    branch: string | null;
    date: string | null;
    maxIterations: number | null;
    ownerApproved: boolean;
    now: string | null;
};
/**
 * Снимок `state.json`: состояние и текст, из которого оно прочитано (#33).
 *
 * Текст нужен писателям: по нему `writeState` видит, что файл изменился между чтением
 * и записью, и отказывается затирать чужую запись. Сравнение побайтное: любое
 * изменение файла — основание для отказа, а не только `updated_at` (его скрытое
 * изменение форматированием было бы незаметно).
 * @param {string} file
 * @returns {{ state: Record<string, any>, raw: string }}
 */
export declare function readStateSnapshot(file: string): {
    state: Record<string, any>;
    raw: string;
};
/**
 * Сверяет файл со снимком (#33). `null` — команда ожидает, что файла ещё нет (`init`).
 * Экспортируется для команд, которые пишут другие артефакты до `state.json`
 * (`escalation.json`): сверить до побочной записи значит не оставить документ, который
 * противоречит состоянию.
 * @param {string} file
 * @param {{ raw: string } | null} snapshot
 * @returns {void}
 */
export declare function assertStateUnchanged(file: string, snapshot: {
    raw: string;
} | null): void;
/**
 * Записывает состояние: сверка со снимком (#33), проверка схемы до записи (мутация не должна
 * уронить файл) и атомарная запись с сортировкой ключей.
 * @param {string} file
 * @param {Record<string, any>} state
 * @param {{ raw: string } | null} snapshot снимок, прочитанный командой; `null` — файла ещё нет
 * @returns {void}
 */
export declare function writeState(file: string, state: Record<string, any>, snapshot: {
    raw: string;
} | null): void;
/**
 * Забирает устаревший файл у пути, не удаляя его «вслепую». Между осмотром (`statSync`) и
 * снятием файл может быть заменён конкурентным процессом, поэтому удаления по пути нет:

 * 1. inode сверяется **до** переноса: чужой (свежий) файл не переименовывается вовсе, а гонка
 *    заканчивается исходом `'other'` без единой записи на диск;
 * 2. файл **переименовывается** в уникальное имя (`<file>.stale.<pid>.<ms>`);
 * 3. по переименованному inode сверяется ещё раз — от подмены между сверкой и `rename`:
 *    свой экземпляр — удаляем, чужой (свежий) — возвращаем;
 * 4. возврат идёт через `linkSync` + `unlinkSync`, а не `renameSync`: `rename` **заменяет**
 *    цель, поэтому мог бы затереть `.lock`, созданный третьим процессом (BLOCKER ревью):
 *    если канонический путь уже занят, восстановление не делается, а конфликт сообщается
 *    явно — осмотренный файл остаётся под именем `<file>.stale.…`, его можно разобрать руками.
 *
 * Экспортируется ради тестов (как `TRANSITIONS`/`mandatoryGatesGreen`): подмену файла между
 * осмотром и снятием (в том числе в окне между сверкой и переносом), а также восстановление
 * в занятый путь иначе не проверить.
 * @param {string} file путь устаревшего файла
 * @param {number} expectedIno inode, который осматривали
 * @param {{ beforeMove?: (file: string) => void, afterMove?: (moved: string) => void }} [hooks] тестовые хуки: окно между сверкой и переносом и момент после переноса
 * @returns {'claimed' | 'gone' | 'other'} результат: сняли свой экземпляр / файла уже нет / чужой файл не тронут либо возвращён
 * @throws {ConflictError} чужой файл вернуть не удалось (канонический путь занят)
 */
export declare function claimStaleFile(file: string, expectedIno: number, hooks?: {
    beforeMove?: (file: string) => void;
    afterMove?: (moved: string) => void;
}): 'claimed' | 'gone' | 'other';
