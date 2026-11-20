/**
 * Детерминированная маршрутизация стадий цикла (issue #47, «фаза 3» §17
 * `docs/orchestrator.md`).
 *
 * Зачем: сейчас маршрутизацию ведёт LLM-супервизор — он читает протокол и решает, какая
 * стадия следующая и какую команду запускать. Это режим persuasion там, где решение можно
 * свести к таблице. Модуль отвечает на один вопрос: **что делать прямо сейчас**, — и
 * отвечает по фактам (`state.json`, наличие артефактов, `decision.<n>.json`), а не по
 * смыслу.
 *
 * Что модуль НЕ делает: не пишет файлов, не запускает процессов, не зовёт моделей. Он
 * возвращает дескриптор шага; CLI (`scripts/cycle-driver.mjs`) превращает его в команды и
 * исполняет. Поэтому планировщик остаётся чистым: вход — данные, выход — решение, тесты без
 * временных каталогов.
 *
 * Источник истины для переходов — `TRANSITIONS`/`advanceTargets` из `cycle-state.mjs`
 * (единственный писатель `state.json`). Копия таблицы здесь запрещена: расхождение
 * автомата и маршрутизатора — это дефект, который не видно ни одним тестом.
 *
 * Границы объёма (issue #47): маршрутизация и запуск детерминированных скриптов. Работу
 * моделей (`plan`, `code`, `review`, `evaluate`), браузерную проверку (`QA_WEB`) и коммиты
 * с PR (`PR`) исполняет супервизор: модуль отдаёт им шаг `spawn`/`handoff` с точным
 * описанием входа, но не выполняет.
 *
 * Shebang не нужен: модуль подключается из CLI-скрипта.
 */
import { advanceTargets } from '../../cycle-state.mjs';

/** Действия шага: что именно делать с текущей стадией. */
export const STEP_ACTIONS = Object.freeze([
  'run',
  'advance',
  'finish',
  'spawn',
  'handoff',
  'stop',
  'blocked',
]);

/**
 * Действия, которые исполняет сам драйвер (детерминированные). Остальные — передача
 * супервизору или остановка.
 * @type {ReadonlySet<string>}
 */
const EXECUTABLE = new Set(['run', 'advance', 'finish']);

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
export const STEP_TOKENS = Object.freeze({
  criteria: 'cycle-evidence criteria',
  'freeze-criteria': 'cycle-state freeze-criteria',
  gates: 'cycle-gates',
  packet: 'cycle-evidence packet',
  decide: 'cycle-decide',
  'apply-decision': 'cycle-state apply-decision',
  metrics: 'cycle-metrics',
  unlock: 'cycle-state unlock',
});

/**
 * Артефакт, которого ждёт каждая стадия. `null` — стадия не ждёт файла.
 * @type {Readonly<Record<string, string|null>>}
 */
const WAITING_FOR = Object.freeze({
  INIT: 'evidence/criteria.md',
  PLAN: 'plan.<n>.md',
  CODE: 'code-report.<n>.md',
  GATES: 'gates.<n>.json',
  QA_WEB: 'qa-web.json',
  REVIEW: 'review.<n>.md',
  EVALUATE: 'evaluation.<n>.md',
  DECIDE: 'decision.<n>.json',
  REWORK: 'rework-brief.<n>.md',
  ACQUIRE_EVIDENCE: null,
  PR: null,
  DONE: null,
  ESCALATED: null,
});

/** Терминальные стадии: работа цикла закончена. */
const TERMINAL = new Set(['DONE', 'ESCALATED']);

/**
 * Признак детерминированного шага, который исполняет сам драйвер.
 * @param {DriverStep} step
 * @returns {boolean}
 */
export function isExecutable(step) {
  return EXECUTABLE.has(step.action);
}

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
 * Куда состояние обязано прийти после шага. `null` — сверять нечего: шаг не двигает стадию
 * сам (`apply-decision` переводит автомат по решению, а `stop`/`blocked` ничего не обещают).
 * Форма входа — минимум полей шага, а не весь `DriverStep`: по этой функции сверяется и запись
 * журнала, у которой нет `spawn`/`allowed_next`/`notes`.
 * @param {{ stage: string, action: string, step: string|null, target: string|null }} step
 * @returns {string[]|null}
 */
export function expectedAfter(step) {
  switch (step.action) {
    case 'advance':
      return step.target === null ? null : [step.target];
    case 'finish':
    case 'spawn':
      return step.target === null ? [step.stage] : [...new Set([step.stage, step.target])];
    case 'handoff':
      // Работа `handoff` — своя (коммиты, PR, бриф, браузер), и заканчивается она не шагом
      // драйвера, а `finish` + `advance` руками супервизора. Поэтому ожидается либо та же
      // стадия, либо любая разрешённая из неё: `PR → DONE` после создания PR — не расхождение.
      return step.target === null
        ? [...new Set([step.stage, ...advanceTargets(step.stage)])]
        : [...new Set([step.stage, step.target])];
    case 'run':
      // `apply-decision` — единственный шаг `run`, который двигает стадию: цель задаёт решение.
      return step.step === 'apply-decision' ? null : [step.stage];
    default:
      return null;
  }
}

/**
 * Разошлось ли состояние с предыдущим ответом драйвера. `ESCALATED` расхождением не считается:
 * эскалация — штатный выход протокола (§18), а не обход маршрута.
 * @param {DriverJournalEntry|null} previous предыдущее решение (в журнале может быть пусто)
 * @param {{ stage: string }} current текущее состояние
 * @returns {boolean}
 */
export function mismatchAfter(previous, current) {
  if (previous === null || previous === undefined) return false;
  if (current.stage === 'ESCALATED') return false;
  const expected = expectedAfter(previous);
  if (expected === null) return false;
  return !expected.includes(current.stage);
}

/**
 * Запись журнала для шага. Чистая функция: время приходит аргументом.
 * @param {{ step: DriverStep, at: string, previous: DriverJournalEntry|null }} input
 *   `previous` — последняя запись журнала: по ней считается `mismatch`
 * @returns {DriverJournalEntry}
 */
export function buildJournalEntry({ step, at, previous }) {
  return {
    at,
    stage: step.stage,
    status: step.status,
    action: step.action,
    step: step.step,
    target: step.target,
    reason: step.reason,
    executed: isExecutable(step),
    mismatch: mismatchAfter(previous, { stage: step.stage }),
  };
}

/**
 * Совпадает ли решение с предыдущей записью. Повторный `next` на том же дереве не должен
 * плодить записи: счётчики журнала — про шаги маршрута, а не про число вопросов.
 * @param {DriverJournalEntry} entry
 * @param {DriverJournalEntry} previous
 * @returns {boolean}
 */
export function sameAnswer(entry, previous) {
  return (
    entry.stage === previous.stage &&
    entry.status === previous.status &&
    entry.action === previous.action &&
    entry.step === previous.step &&
    entry.target === previous.target &&
    entry.reason === previous.reason
  );
}

/**
 * Разбор журнала (JSONL). Битая строка — отказ, а не пропуск: молча потерянная запись
 * искажает `driver.mismatch`, а именно по нему решается вопрос §17.
 * @param {string} text содержимое `driver.jsonl`
 * @returns {DriverJournalEntry[]}
 */
export function parseJournal(text) {
  /** @type {DriverJournalEntry[]} */
  const entries = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    /** @type {unknown} */
    let raw;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`driver.jsonl: строка ${index + 1}: не JSON (${message})`);
    }
    const record = /** @type {Record<string, any>} */ (raw);
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw new Error(`driver.jsonl: строка ${index + 1}: ожидается объект`);
    }
    for (const field of ['stage', 'status', 'action', 'reason']) {
      if (typeof record[field] !== 'string') {
        throw new Error(`driver.jsonl: строка ${index + 1}: ${field} должен быть строкой`);
      }
    }
    for (const field of ['executed', 'mismatch']) {
      if (typeof record[field] !== 'boolean') {
        throw new Error(`driver.jsonl: строка ${index + 1}: ${field} должен быть boolean`);
      }
    }
    entries.push({
      at: typeof record.at === 'string' ? record.at : '',
      stage: record.stage,
      status: record.status,
      action: record.action,
      step: typeof record.step === 'string' ? record.step : null,
      target: typeof record.target === 'string' ? record.target : null,
      reason: record.reason,
      executed: record.executed,
      mismatch: record.mismatch,
    });
  });
  return entries;
}

/**
 * Счётчики журнала для `metrics.json`. Чистая функция: вход — записи, выход — числа.
 * @param {DriverJournalEntry[]} entries
 * @returns {DriverJournalSummary}
 */
export function summarizeJournal(entries) {
  return {
    steps: entries.length,
    executed: entries.filter((entry) => entry.executed).length,
    handed_off: entries.filter((entry) => entry.action === 'spawn' || entry.action === 'handoff')
      .length,
    mismatch: entries.filter((entry) => entry.mismatch).length,
  };
}

/**
 * Собирает дескриптор с полями по умолчанию.
 * @param {DriverState} state
 * @param {Partial<DriverStep> & { action: string, reason: string }} fields
 * @returns {DriverStep}
 */
function makeStep(state, fields) {
  return {
    stage: state.stage,
    status: state.stage_status,
    action: fields.action,
    reason: fields.reason,
    step: fields.step ?? null,
    target: fields.target ?? null,
    gate: fields.gate ?? null,
    spawn: fields.spawn ?? null,
    allowed_next: fields.allowed_next ?? advanceTargets(state.stage),
    waiting_for: fields.waiting_for ?? WAITING_FOR[state.stage] ?? null,
    notes: fields.notes ?? [],
  };
}

/**
 * Куда идти после закрытой стадии. Значение — решение кода, а не супервизора: гейт
 * `QA_WEB` включается только при web-диффе, `ACQUIRE_EVIDENCE` — по списку `acquire[]`
 * решения.
 * @param {DriverState} state
 * @param {DriverArtifacts} artifacts
 * @returns {{ target: string|null, reason: string, gate?: string }}
 */
function nextStageAfterDone(state, artifacts) {
  switch (state.stage) {
    case 'INIT':
      return { target: 'PLAN', reason: 'init_done' };
    case 'PLAN':
      return { target: 'CODE', reason: 'plan_done' };
    case 'CODE':
      return { target: 'GATES', reason: 'code_done' };
    case 'GATES':
      return artifacts.webDiff
        ? { target: 'QA_WEB', reason: 'web_diff' }
        : { target: 'REVIEW', reason: 'no_web_diff' };
    case 'QA_WEB':
      return { target: 'REVIEW', reason: 'qa_web_done' };
    case 'REVIEW':
      return { target: 'EVALUATE', reason: 'review_done' };
    case 'EVALUATE':
      return { target: 'DECIDE', reason: 'evaluate_done' };
    case 'REWORK':
      return { target: 'CODE', reason: 'rework_done' };
    case 'ACQUIRE_EVIDENCE':
      return acquireTarget(artifacts);
    case 'PR':
      return { target: 'DONE', reason: 'pr_done' };
    default:
      return { target: null, reason: 'no_transition' };
  }
}

/**
 * Гейт из `decision.<n>.json`, который нужно добрать (`acquire: ["gate:<id>"]`).
 * @param {Record<string, any>|null} decisionDoc решение
 * @returns {string|null}
 */
function acquireGate(decisionDoc) {
  const acquire = Array.isArray(decisionDoc?.acquire) ? decisionDoc.acquire : [];
  for (const token of acquire) {
    if (typeof token === 'string' && token.startsWith('gate:')) return token.slice('gate:'.length);
  }
  return null;
}

/**
 * Куда идти после `ACQUIRE_EVIDENCE`: список `acquire[]` решения говорит, что добрать.
 * Гейт важнее браузерной проверки — порядок §5.6.
 * @param {DriverArtifacts} artifacts
 * @returns {{ target: string|null, reason: string, gate?: string }}
 */
function acquireTarget(artifacts) {
  const acquire = Array.isArray(artifacts.decisionDoc?.acquire)
    ? /** @type {unknown[]} */ (artifacts.decisionDoc?.acquire)
    : [];
  const tokens = acquire.filter((item) => typeof item === 'string');
  const gate = acquireGate(artifacts.decisionDoc);
  if (gate !== null) return { target: 'GATES', reason: 'acquire_gate', gate };
  if (tokens.includes('qa-web')) return { target: 'QA_WEB', reason: 'acquire_qa_web' };
  if (tokens.includes('integrity')) return { target: 'REVIEW', reason: 'acquire_integrity' };
  return { target: 'REVIEW', reason: 'acquire_nothing' };
}

/**
 * Шаг для стадии, которая ещё идёт (`stage_status = running`).
 * @param {DriverState} state
 * @param {DriverArtifacts} artifacts
 * @returns {DriverStep}
 */
function runningStep(state, artifacts) {
  switch (state.stage) {
    case 'INIT':
      if (!artifacts.criteria)
        return makeStep(state, { action: 'run', reason: 'criteria_missing', step: 'criteria' });
      if (state.criteria_sha256 === null) {
        return makeStep(state, {
          action: 'run',
          reason: 'criteria_not_frozen',
          step: 'freeze-criteria',
        });
      }
      return makeStep(state, { action: 'advance', reason: 'init_ready', target: 'PLAN' });
    case 'PLAN':
      if (artifacts.plan)
        return makeStep(state, { action: 'finish', reason: 'plan_written', target: 'PLAN' });
      return makeStep(state, {
        action: 'spawn',
        reason: 'plan_missing',
        spawn: { agent: 'plan', inputs: ['issue.json', 'criteria.md'] },
      });
    case 'CODE':
      if (artifacts.codeReport)
        return makeStep(state, { action: 'finish', reason: 'code_report_written', target: 'CODE' });
      return makeStep(state, {
        action: 'spawn',
        reason: 'code_report_missing',
        spawn: { agent: 'code', inputs: ['plan.<n>.md', 'criteria.md'] },
      });
    case 'GATES':
      if (artifacts.gates)
        return makeStep(state, { action: 'finish', reason: 'gates_written', target: 'GATES' });
      // После `ACQUIRE_EVIDENCE` повторяется только недостающий гейт (`--only`), а не весь набор.
      return makeStep(state, {
        action: 'run',
        reason: 'gates_missing',
        step: 'gates',
        gate: acquireGate(artifacts.decisionDoc),
      });
    case 'QA_WEB':
      if (artifacts.qaWeb)
        return makeStep(state, { action: 'finish', reason: 'qa_web_written', target: 'QA_WEB' });
      return makeStep(state, {
        action: 'handoff',
        reason: 'qa_web_missing',
        spawn: { agent: 'supervisor', inputs: ['docs/qa-web.md', 'qa-web.json'] },
      });
    case 'REVIEW':
      if (!artifacts.evidence)
        return makeStep(state, { action: 'run', reason: 'evidence_missing', step: 'packet' });
      if (artifacts.review)
        return makeStep(state, { action: 'finish', reason: 'review_written', target: 'REVIEW' });
      return makeStep(state, {
        action: 'spawn',
        reason: 'review_missing',
        spawn: { agent: 'review', inputs: ['evidence/'] },
      });
    case 'EVALUATE':
      if (artifacts.evaluation)
        return makeStep(state, {
          action: 'finish',
          reason: 'evaluation_written',
          target: 'EVALUATE',
        });
      return makeStep(state, {
        action: 'spawn',
        reason: 'evaluation_missing',
        spawn: { agent: 'evaluate', inputs: ['evidence/'] },
      });
    case 'DECIDE':
      if (artifacts.decision)
        return makeStep(state, {
          action: 'run',
          reason: 'decision_written',
          step: 'apply-decision',
        });
      return makeStep(state, { action: 'run', reason: 'decision_missing', step: 'decide' });
    case 'REWORK':
      if (artifacts.reworkBrief)
        return makeStep(state, {
          action: 'finish',
          reason: 'rework_brief_written',
          target: 'REWORK',
        });
      return makeStep(state, {
        action: 'handoff',
        reason: 'rework_brief_missing',
        spawn: { agent: 'supervisor', inputs: ['decision.<n>.json#rework_items'] },
      });
    case 'ACQUIRE_EVIDENCE':
      return makeStep(state, {
        action: 'finish',
        reason: 'acquire_accounting',
        target: 'ACQUIRE_EVIDENCE',
      });
    case 'PR':
      return makeStep(state, {
        action: 'handoff',
        reason: 'pr_pending',
        spawn: { agent: 'supervisor', inputs: ['followups.md', 'decision.<n>.json'] },
      });
    default:
      return makeStep(state, {
        action: 'blocked',
        reason: 'unknown_stage',
        notes: [`неизвестная стадия ${state.stage}`],
      });
  }
}

/**
 * Шаг для терминальной стадии: метрики и снятие блокировки, если они ещё не сделаны.
 * @param {DriverState} state
 * @param {DriverArtifacts} artifacts
 * @returns {DriverStep}
 */
function terminalStep(state, artifacts) {
  if (!artifacts.metrics) {
    return makeStep(state, {
      action: 'run',
      reason: 'metrics_missing',
      step: 'metrics',
      allowed_next: [],
    });
  }
  if (artifacts.lock) {
    return makeStep(state, {
      action: 'run',
      reason: 'lock_present',
      step: 'unlock',
      allowed_next: [],
    });
  }
  return makeStep(state, { action: 'stop', reason: 'terminal', allowed_next: [] });
}

/**
 * Определяет следующий шаг цикла. Чистая функция: одинаковый вход — одинаковый выход.
 * @param {{ state: DriverState, artifacts: DriverArtifacts }} input
 * @returns {DriverStep}
 */
export function planStep({ state, artifacts }) {
  if (TERMINAL.has(state.stage)) return terminalStep(state, artifacts);

  if (state.stage_status === 'error') {
    return makeStep(state, {
      action: 'blocked',
      reason: 'stage_error',
      notes: ['стадия закрыта с ошибкой: повторить её (`advance --to <стадия>`) или эскалировать'],
    });
  }

  if (state.stage_status === 'done') {
    // INIT закрыт с момента `init` (у него нет `finish`), но критерии и их заморозка —
    // часть INIT по Приложению B: сначала файл, потом дайджест, потом переход в PLAN.
    if (state.stage === 'INIT') {
      if (!artifacts.criteria) {
        return makeStep(state, { action: 'run', reason: 'criteria_missing', step: 'criteria' });
      }
      if (state.criteria_sha256 === null) {
        return makeStep(state, {
          action: 'run',
          reason: 'criteria_not_frozen',
          step: 'freeze-criteria',
        });
      }
      return makeStep(state, { action: 'advance', reason: 'init_ready', target: 'PLAN' });
    }

    const { target, reason, gate } = nextStageAfterDone(state, artifacts);
    if (target === null) {
      return makeStep(state, {
        action: 'blocked',
        reason,
        notes: [`из стадии ${state.stage} нет перехода по фактам`],
      });
    }
    return makeStep(state, { action: 'advance', reason, target, gate: gate ?? null });
  }

  return runningStep(state, artifacts);
}

/**
 * Человекочитаемая строка шага — для stderr и логов. JSON остаётся контрактом.
 * @param {DriverStep} step
 * @returns {string}
 */
export function describeStep(step) {
  const target = step.target === null ? '' : ` → ${step.target}`;
  const token = step.step === null ? '' : ` [${step.step}]`;
  const spawn = step.spawn === null ? '' : ` (${step.spawn.agent})`;
  return `${step.stage}/${step.status}: ${step.action}${target}${token}${spawn} — ${step.reason}`;
}
