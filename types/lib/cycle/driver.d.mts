/** Действия шага: что именно делать с текущей стадией. */
export declare const STEP_ACTIONS: readonly string[];
export type DriverState = {
    stage: string;
    stage_status: string;
    iteration: number;
    /**
     * база цикла — от неё считается web-дифф
     */
    base_sha: string;
    criteria_sha256: string | null;
    escalation: Record<string, any> | null;
};
export type DriverArtifacts = {
    /**
     * `evidence/criteria.md`
     */
    criteria: boolean;
    /**
     * `plan.<n>.md`
     */
    plan: boolean;
    /**
     * `code-report.<n>.md`
     */
    codeReport: boolean;
    /**
     * `gates.<n>.json`
     */
    gates: boolean;
    /**
     * `qa-web.json`
     */
    qaWeb: boolean;
    /**
     * пакет `evidence/` собран для текущей итерации
     */
    evidence: boolean;
    /**
     * `review.<n>.md`
     */
    review: boolean;
    /**
     * `evaluation.<n>.md`
     */
    evaluation: boolean;
    /**
     * `decision.<n>.json`
     */
    decision: boolean;
    /**
     * `rework-brief.<n>.md`
     */
    reworkBrief: boolean;
    /**
     * `followups.md`
     */
    followups: boolean;
    /**
     * `metrics.json`
     */
    metrics: boolean;
    /**
     * `.lock` в каталоге цикла
     */
    lock: boolean;
    /**
     * дифф затрагивает `qaWeb.pathPrefixes`
     */
    webDiff: boolean;
    /**
     * разобранный `decision.<n>.json`
     */
    decisionDoc: Record<string, any> | null;
};
export type DriverStep = {
    /**
     * текущая стадия
     */
    stage: string;
    /**
     * `stage_status`
     */
    status: string;
    /**
     * одно из `STEP_ACTIONS`
     */
    action: string;
    /**
     * машиночитаемая причина решения
     */
    reason: string;
    /**
     * токен детерминированного шага (`criteria`, `gates`, …)
     */
    step: string | null;
    /**
     * стадия перехода
     */
    target: string | null;
    /**
     * гейт для `--only` при доборе свидетельства
     */
    gate: string | null;
    /**
     * кому передать работу
     */
    spawn: {
        agent: string;
        inputs: string[];
    } | null;
    /**
     * допустимые переходы из текущей стадии
     */
    allowed_next: string[];
    /**
     * артефакт, которого ждёт стадия
     */
    waiting_for: string | null;
    /**
     * пояснения для супервизора
     */
    notes: string[];
};
/**
 * Состояние `state.json` в объёме, который нужен маршрутизации. Полная схема — в
 * `validate.mjs`; здесь только поля, по которым принимается решение.
 * @typedef {object} DriverState
 * @property {string} stage
 * @property {string} stage_status
 * @property {number} iteration
 * @property {string} base_sha база цикла — от неё считается web-дифф
 * @property {string|null} criteria_sha256
 * @property {Record<string, any>|null} escalation
 */
/**
 * Наличие артефактов на диске. Считает вызывающий: планировщик не ходит в файловую систему,
 * поэтому решение остаётся чистым и одинаковым в тестах и в бою.
 * @typedef {object} DriverArtifacts
 * @property {boolean} criteria `evidence/criteria.md`
 * @property {boolean} plan `plan.<n>.md`
 * @property {boolean} codeReport `code-report.<n>.md`
 * @property {boolean} gates `gates.<n>.json`
 * @property {boolean} qaWeb `qa-web.json`
 * @property {boolean} evidence пакет `evidence/` собран для текущей итерации
 * @property {boolean} review `review.<n>.md`
 * @property {boolean} evaluation `evaluation.<n>.md`
 * @property {boolean} decision `decision.<n>.json`
 * @property {boolean} reworkBrief `rework-brief.<n>.md`
 * @property {boolean} followups `followups.md`
 * @property {boolean} metrics `metrics.json`
 * @property {boolean} lock `.lock` в каталоге цикла
 * @property {boolean} webDiff дифф затрагивает `qaWeb.pathPrefixes`
 * @property {Record<string, any>|null} decisionDoc разобранный `decision.<n>.json`
 */
/**
 * Дескриптор шага. `step` — что запустить (`null` для неисполняемых действий), `target` —
 * стадия для `advance`/`finish`, `spawn` — кому передать работу.
 * @typedef {object} DriverStep
 * @property {string} stage текущая стадия
 * @property {string} status `stage_status`
 * @property {string} action одно из `STEP_ACTIONS`
 * @property {string} reason машиночитаемая причина решения
 * @property {string|null} step токен детерминированного шага (`criteria`, `gates`, …)
 * @property {string|null} target стадия перехода
 * @property {string|null} gate гейт для `--only` при доборе свидетельства
 * @property {{ agent: string, inputs: string[] }|null} spawn кому передать работу
 * @property {string[]} allowed_next допустимые переходы из текущей стадии
 * @property {string|null} waiting_for артефакт, которого ждёт стадия
 * @property {string[]} notes пояснения для супервизора
 */
/**
 * Токены детерминированных шагов. CLI превращает их в команды; планировщик не знает ни
 * путей, ни флагов.
 * @type {Readonly<Record<string, string>>}
 */
export declare const STEP_TOKENS: Readonly<Record<string, string>>;
/**
 * Признак детерминированного шага, который исполняет сам драйвер.
 * @param {DriverStep} step
 * @returns {boolean}
 */
export declare function isExecutable(step: DriverStep): boolean;
export type DriverJournalEntry = {
    /**
     * момент решения, ISO 8601
     */
    at: string;
    /**
     * стадия, для которой принято решение
     */
    stage: string;
    /**
     * `stage_status` на момент решения
     */
    status: string;
    /**
     * действие шага
     */
    action: string;
    /**
     * токен детерминированного шага
     */
    step: string | null;
    /**
     * целевая стадия
     */
    target: string | null;
    /**
     * причина решения
     */
    reason: string;
    /**
     * исполняет ли шаг драйвер (а не супервизор)
     */
    executed: boolean;
    /**
     * разошлось ли состояние с предыдущим ответом драйвера
     */
    mismatch: boolean;
};
export type DriverJournalSummary = {
    /**
     * всего решений драйвера
     */
    steps: number;
    /**
     * из них исполнено самим драйвером
     */
    executed: number;
    /**
     * передано супервизору (`spawn`/`handoff`)
     */
    handed_off: number;
    /**
     * сколько раз состояние разошлось с ответом драйвера
     */
    mismatch: number;
};
/**
 * Запись журнала драйвера (`driver.jsonl`, имена — `FIXED_NAMES.driverJournal`). Журнал
 * нужен одному: блоку `driver` в `metrics.json` (#47). Он отвечает на вопрос «маршрутизация
 * правда кодом?» счётчиками, а не мнением: сколько шагов драйвер выдал, сколько исполнил сам
 * и сколько раз состояние ушло не туда, куда он сказал.
 * @typedef {object} DriverJournalEntry
 * @property {string} at момент решения, ISO 8601
 * @property {string} stage стадия, для которой принято решение
 * @property {string} status `stage_status` на момент решения
 * @property {string} action действие шага
 * @property {string|null} step токен детерминированного шага
 * @property {string|null} target целевая стадия
 * @property {string} reason причина решения
 * @property {boolean} executed исполняет ли шаг драйвер (а не супервизор)
 * @property {boolean} mismatch разошлось ли состояние с предыдущим ответом драйвера
 */
/**
 * Сводка журнала — блок `driver` в `metrics.json`.
 * @typedef {object} DriverJournalSummary
 * @property {number} steps всего решений драйвера
 * @property {number} executed из них исполнено самим драйвером
 * @property {number} handed_off передано супервизору (`spawn`/`handoff`)
 * @property {number} mismatch сколько раз состояние разошлось с ответом драйвера
 */
/**
 * Идентификатор контракта вывода `next` (§5.3a `docs/orchestrator-core.md`). Адаптер (ADR 0004,
 * issue #74) читает вывод, не импортируя код ядра, поэтому ему нужно обещание формы, а не набор
 * полей текущей ревизии. Добавление поля версию не меняет; удаление, переименование или смена
 * смысла — меняет, и адаптер обязан на чужой версии отказать, а не угадывать.
 * @type {string}
 */
export declare const CONTRACT_ID: string;
export type DriverCycle = {
    /**
     * номер issue цикла
     */
    issue: number | null;
    /**
     * ветка цикла
     */
    branch: string;
    /**
     * каталог артефактов цикла
     */
    dir: string;
    /**
     * текущая итерация
     */
    iteration: number;
    /**
     * лимит итераций цикла
     */
    max_iterations: number | null;
    /**
     * стадия (дубль `stage` шага — чтобы блок читался сам по себе)
     */
    stage: string;
    /**
     * статус стадии
     */
    stage_status: string;
    /**
     * подтверждение владельца на текущей стадии
     */
    owner_approved: boolean | null;
    /**
     * эскалация из `state.json`, если была
     */
    escalation: Record<string, any> | null;
};
export type DriverDoneStage = {
    stage: string;
    iteration: number;
    status: string;
    /**
     * `null` — этап ещё идёт
     */
    finished_at: string | null;
};
export type DriverDone = {
    /**
     * последние этапы `state.history`, в порядке файла
     */
    stages: DriverDoneStage[];
    /**
     * сводка `driver.jsonl`; `null` — журнала нет
     */
    driver: DriverJournalSummary | null;
};
/**
 * Состояние цикла для человека и адаптера: то, что лежит в `state.json` и не входит в дескриптор
 * шага. Отдельный блок, а не поля верхнего уровня, — чтобы `action`/`step`/`reason` оставались
 * ответом на один вопрос «что делать сейчас», а не смешивались с «где мы».
 * @typedef {object} DriverCycle
 * @property {number|null} issue номер issue цикла
 * @property {string} branch ветка цикла
 * @property {string} dir каталог артефактов цикла
 * @property {number} iteration текущая итерация
 * @property {number|null} max_iterations лимит итераций цикла
 * @property {string} stage стадия (дубль `stage` шага — чтобы блок читался сам по себе)
 * @property {string} stage_status статус стадии
 * @property {boolean|null} owner_approved подтверждение владельца на текущей стадии
 * @property {Record<string, any>|null} escalation эскалация из `state.json`, если была
 */
/**
 * Завершённый (или идущий) этап истории цикла: «что сделано».
 * @typedef {object} DriverDoneStage
 * @property {string} stage
 * @property {number} iteration
 * @property {string} status
 * @property {string|null} finished_at `null` — этап ещё идёт
 */
/**
 * Блок «что сделано»: история стадий и счётчики журнала решений. Второй элемент важен отдельно:
 * он отвечает, сколько шагов драйвер выдал и сколько исполнял сам (§5.3a).
 * @typedef {object} DriverDone
 * @property {DriverDoneStage[]} stages последние этапы `state.history`, в порядке файла
 * @property {DriverJournalSummary|null} driver сводка `driver.jsonl`; `null` — журнала нет
 */
/**
 * Куда состояние обязано прийти после шага. `null` — сверять нечего: шаг не двигает стадию
 * сам (`apply-decision` переводит автомат по решению, а `stop`/`blocked` ничего не обещают).
 * Форма входа — минимум полей шага, а не весь `DriverStep`: по этой функции сверяется и запись
 * журнала, у которой нет `spawn`/`allowed_next`/`notes`.
 * @param {{ stage: string, action: string, step: string|null, target: string|null }} step
 * @returns {string[]|null}
 */
export declare function expectedAfter(step: {
    stage: string;
    action: string;
    step: string | null;
    target: string | null;
}): string[] | null;
/**
 * Разошлось ли состояние с предыдущим ответом драйвера. `ESCALATED` расхождением не считается:
 * эскалация — штатный выход протокола (§18), а не обход маршрута.
 * @param {DriverJournalEntry|null} previous предыдущее решение (в журнале может быть пусто)
 * @param {{ stage: string }} current текущее состояние
 * @returns {boolean}
 */
export declare function mismatchAfter(previous: DriverJournalEntry | null, current: {
    stage: string;
}): boolean;
/**
 * Запись журнала для шага. Чистая функция: время приходит аргументом.
 * @param {{ step: DriverStep, at: string, previous: DriverJournalEntry|null }} input
 *   `previous` — последняя запись журнала: по ней считается `mismatch`
 * @returns {DriverJournalEntry}
 */
export declare function buildJournalEntry({ step, at, previous }: {
    step: DriverStep;
    at: string;
    previous: DriverJournalEntry | null;
}): DriverJournalEntry;
/**
 * Совпадает ли решение с предыдущей записью. Повторный `next` на том же дереве не должен
 * плодить записи: счётчики журнала — про шаги маршрута, а не про число вопросов.
 * @param {DriverJournalEntry} entry
 * @param {DriverJournalEntry} previous
 * @returns {boolean}
 */
export declare function sameAnswer(entry: DriverJournalEntry, previous: DriverJournalEntry): boolean;
/**
 * Разбор журнала (JSONL). Битая строка — отказ, а не пропуск: молча потерянная запись
 * искажает `driver.mismatch`, а именно по нему решается вопрос §17.
 * @param {string} text содержимое `driver.jsonl`
 * @returns {DriverJournalEntry[]}
 */
export declare function parseJournal(text: string): DriverJournalEntry[];
/**
 * Счётчики журнала для `metrics.json`. Чистая функция: вход — записи, выход — числа.
 * @param {DriverJournalEntry[]} entries
 * @returns {DriverJournalSummary}
 */
export declare function summarizeJournal(entries: DriverJournalEntry[]): DriverJournalSummary;
/**
 * Блок `cycle` вывода `next`: где цикл сейчас. Поля берутся из `state.json` как есть — валидатор
 * уже проверил их типы, а вычислять здесь нечего: производное число вместо замера показывало бы
 * уверенность там, где её нет.
 * @param {Record<string, any>} state разобранный `state.json` (уже прошёл `validateState`)
 * @param {string} dir каталог артефактов цикла
 * @returns {DriverCycle}
 */
export declare function cycleSnapshot(state: Record<string, any>, dir: string): DriverCycle;
/**
 * Блок «что сделано»: последние `limit` записей `state.history` в порядке файла (старые → новые).
 * Потолок нужен для длинных циклов: вторая итерация `review`/`evaluate` не должна раздувать
 * вывод, который читает человек.
 * @param {Record<string, any>} state разобранный `state.json`
 * @param {number} [limit] сколько последних этапов оставить
 * @returns {DriverDoneStage[]}
 */
export declare function doneStages(state: Record<string, any>, limit?: number): DriverDoneStage[];
/**
 * Определяет следующий шаг цикла. Чистая функция: одинаковый вход — одинаковый выход.
 * @param {{ state: DriverState, artifacts: DriverArtifacts }} input
 * @returns {DriverStep}
 */
export declare function planStep({ state, artifacts }: {
    state: DriverState;
    artifacts: DriverArtifacts;
}): DriverStep;
/**
 * Человекочитаемая строка шага — для stderr и логов. JSON остаётся контрактом.
 * @param {DriverStep} step
 * @returns {string}
 */
export declare function describeStep(step: DriverStep): string;
