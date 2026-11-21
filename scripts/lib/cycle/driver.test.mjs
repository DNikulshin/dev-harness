import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { TRANSITIONS, advanceTargets } from '../../cycle-state.mjs';

/** Все стадии автомата — из таблицы переходов §5.3, а не из копии списка. */
const STAGES = Object.keys(TRANSITIONS);
import {
  CONTRACT_ID,
  STEP_ACTIONS,
  buildJournalEntry,
  cycleSnapshot,
  describeStep,
  doneStages,
  expectedAfter,
  isExecutable,
  mismatchAfter,
  parseJournal,
  planStep,
  sameAnswer,
  summarizeJournal,
} from './driver.mjs';

/**
 * Состояние с полями, которые нужны планировщику.
 * @param {Record<string, any>} [overrides]
 * @returns {import('./driver.mjs').DriverState}
 */
function state(overrides = {}) {
  return {
    stage: 'CODE',
    stage_status: 'running',
    iteration: 1,
    base_sha: 'a'.repeat(40),
    criteria_sha256: 'b'.repeat(64),
    escalation: null,
    ...overrides,
  };
}

/**
 * Наличие артефактов: по умолчанию ничего нет.
 * @param {Record<string, any>} [overrides]
 * @returns {import('./driver.mjs').DriverArtifacts}
 */
function artifacts(overrides = {}) {
  return {
    criteria: false,
    plan: false,
    codeReport: false,
    gates: false,
    qaWeb: false,
    evidence: false,
    review: false,
    evaluation: false,
    decision: false,
    reworkBrief: false,
    followups: false,
    metrics: false,
    lock: false,
    webDiff: false,
    decisionDoc: null,
    ...overrides,
  };
}

/**
 * Планировщик для пары «состояние + артефакты».
 * @param {Record<string, any>} stateOverrides
 * @param {Record<string, any>} [artifactOverrides]
 * @returns {import('./driver.mjs').DriverStep}
 */
function plan(stateOverrides, artifactOverrides = {}) {
  return planStep({ state: state(stateOverrides), artifacts: artifacts(artifactOverrides) });
}

describe('planStep: терминальные стадии', () => {
  test('DONE без metrics.json — метрики, затем остановка', () => {
    const step = plan({ stage: 'DONE', stage_status: 'running' });
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'metrics');
    assert.equal(step.reason, 'metrics_missing');
    assert.deepEqual(step.allowed_next, []);
  });

  test('DONE с metrics.json, но с живым lock — снятие блокировки', () => {
    const step = plan({ stage: 'DONE', stage_status: 'running' }, { metrics: true, lock: true });
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'unlock');
    assert.equal(step.reason, 'lock_present');
  });

  test('ESCALATED с метриками и без lock — остановка', () => {
    const step = plan({ stage: 'ESCALATED', stage_status: 'running' }, { metrics: true });
    assert.equal(step.action, 'stop');
    assert.equal(step.reason, 'terminal');
    assert.deepEqual(step.allowed_next, []);
  });
});

describe('planStep: стадия ещё идёт', () => {
  test('INIT без criteria.md — добыча критериев', () => {
    const step = plan({ stage: 'INIT', stage_status: 'done' });
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'criteria');
  });

  test('INIT с criteria.md, но без заморозки — заморозка', () => {
    const step = plan(
      { stage: 'INIT', stage_status: 'done', criteria_sha256: null },
      { criteria: true },
    );
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'freeze-criteria');
  });

  test('INIT с замороженными критериями — переход в PLAN', () => {
    const step = plan({ stage: 'INIT', stage_status: 'done' }, { criteria: true });
    assert.equal(step.action, 'advance');
    assert.equal(step.target, 'PLAN');
    assert.deepEqual(step.allowed_next, ['PLAN']);
  });

  test('PLAN без плана — работа субагента plan', () => {
    const step = plan({ stage: 'PLAN' });
    assert.equal(step.action, 'spawn');
    assert.equal(step.spawn?.agent, 'plan');
    assert.deepEqual(step.spawn?.inputs, ['issue.json', 'criteria.md']);
  });

  test('PLAN с планом — закрытие стадии', () => {
    const step = plan({ stage: 'PLAN' }, { plan: true });
    assert.equal(step.action, 'finish');
    assert.equal(step.target, 'PLAN');
  });

  test('CODE без отчёта — работа субагента code', () => {
    const step = plan({ stage: 'CODE' });
    assert.equal(step.action, 'spawn');
    assert.equal(step.spawn?.agent, 'code');
  });

  test('GATES без gates.json — запуск гейтов', () => {
    const step = plan({ stage: 'GATES' });
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'gates');
    assert.equal(step.gate, null);
  });

  test('GATES после ACQUIRE_EVIDENCE — только недостающий гейт', () => {
    const step = plan({ stage: 'GATES' }, { decisionDoc: { acquire: ['gate:unit', 'qa-web'] } });
    assert.equal(step.step, 'gates');
    assert.equal(step.gate, 'unit');
  });

  test('QA_WEB без qa-web.json — передача супервизору', () => {
    const step = plan({ stage: 'QA_WEB' });
    assert.equal(step.action, 'handoff');
    assert.equal(step.spawn?.agent, 'supervisor');
  });

  test('REVIEW без пакета свидетельств — сначала packet', () => {
    const step = plan({ stage: 'REVIEW' });
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'packet');
  });

  test('REVIEW с пакетом, но без ревью — работа субагента review', () => {
    const step = plan({ stage: 'REVIEW' }, { evidence: true });
    assert.equal(step.action, 'spawn');
    assert.equal(step.spawn?.agent, 'review');
    assert.deepEqual(step.spawn?.inputs, ['evidence/']);
  });

  test('EVALUATE без оценки — работа субагента evaluate', () => {
    const step = plan({ stage: 'EVALUATE' }, { evidence: true });
    assert.equal(step.action, 'spawn');
    assert.equal(step.spawn?.agent, 'evaluate');
  });

  test('DECIDE без решения — машинное решение', () => {
    const step = plan({ stage: 'DECIDE' });
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'decide');
  });

  test('DECIDE с решением — применение решения', () => {
    const step = plan({ stage: 'DECIDE' }, { decision: true });
    assert.equal(step.action, 'run');
    assert.equal(step.step, 'apply-decision');
  });

  test('REWORK без брифа — передача супервизору', () => {
    const step = plan({ stage: 'REWORK' });
    assert.equal(step.action, 'handoff');
    assert.equal(step.reason, 'rework_brief_missing');
  });

  test('ACQUIRE_EVIDENCE — учётная стадия закрывается сразу', () => {
    const step = plan({ stage: 'ACQUIRE_EVIDENCE' });
    assert.equal(step.action, 'finish');
    assert.equal(step.target, 'ACQUIRE_EVIDENCE');
  });

  test('PR — передача супервизору', () => {
    const step = plan({ stage: 'PR' });
    assert.equal(step.action, 'handoff');
    assert.equal(step.reason, 'pr_pending');
  });
});

describe('planStep: переход после закрытой стадии', () => {
  test('INIT → PLAN после собранных и замороженных критериев', () => {
    const step = plan({ stage: 'INIT', stage_status: 'done' }, { criteria: true });
    assert.equal(step.action, 'advance');
    assert.equal(step.target, 'PLAN');
  });

  test('PLAN → CODE', () => {
    assert.equal(plan({ stage: 'PLAN', stage_status: 'done' }).target, 'CODE');
  });

  test('CODE → GATES', () => {
    assert.equal(plan({ stage: 'CODE', stage_status: 'done' }).target, 'GATES');
  });

  test('GATES без web-диффа → REVIEW', () => {
    const step = plan({ stage: 'GATES', stage_status: 'done' });
    assert.equal(step.target, 'REVIEW');
    assert.equal(step.reason, 'no_web_diff');
  });

  test('GATES с web-диффом → QA_WEB', () => {
    const step = plan({ stage: 'GATES', stage_status: 'done' }, { webDiff: true });
    assert.equal(step.target, 'QA_WEB');
    assert.equal(step.reason, 'web_diff');
  });

  test('QA_WEB → REVIEW', () => {
    assert.equal(plan({ stage: 'QA_WEB', stage_status: 'done' }).target, 'REVIEW');
  });

  test('REVIEW → EVALUATE', () => {
    assert.equal(plan({ stage: 'REVIEW', stage_status: 'done' }).target, 'EVALUATE');
  });

  test('EVALUATE → DECIDE', () => {
    assert.equal(plan({ stage: 'EVALUATE', stage_status: 'done' }).target, 'DECIDE');
  });

  test('REWORK → CODE', () => {
    assert.equal(plan({ stage: 'REWORK', stage_status: 'done' }).target, 'CODE');
  });

  test('PR → DONE', () => {
    assert.equal(plan({ stage: 'PR', stage_status: 'done' }).target, 'DONE');
  });

  test('ACQUIRE_EVIDENCE с гейтом в acquire → GATES', () => {
    const step = plan(
      { stage: 'ACQUIRE_EVIDENCE', stage_status: 'done' },
      { decisionDoc: { acquire: ['gate:unit', 'qa-web'] } },
    );
    assert.equal(step.target, 'GATES');
    assert.equal(step.gate, 'unit');
  });

  test('ACQUIRE_EVIDENCE только с qa-web → QA_WEB', () => {
    const step = plan(
      { stage: 'ACQUIRE_EVIDENCE', stage_status: 'done' },
      { decisionDoc: { acquire: ['qa-web'] } },
    );
    assert.equal(step.target, 'QA_WEB');
  });

  test('ACQUIRE_EVIDENCE с integrity → REVIEW', () => {
    const step = plan(
      { stage: 'ACQUIRE_EVIDENCE', stage_status: 'done' },
      { decisionDoc: { acquire: ['integrity'] } },
    );
    assert.equal(step.target, 'REVIEW');
  });

  test('ACQUIRE_EVIDENCE с пустым acquire → REVIEW', () => {
    const step = plan(
      { stage: 'ACQUIRE_EVIDENCE', stage_status: 'done' },
      { decisionDoc: { acquire: [] } },
    );
    assert.equal(step.target, 'REVIEW');
    assert.equal(step.reason, 'acquire_nothing');
  });

  test('DECIDE закрытым не бывает — протокол нарушен', () => {
    const step = plan({ stage: 'DECIDE', stage_status: 'done' });
    assert.equal(step.action, 'blocked');
    assert.equal(step.reason, 'no_transition');
    assert.equal(step.target, null);
  });
});

describe('planStep: аварийные состояния', () => {
  test('стадия закрыта с ошибкой — решение за человеком', () => {
    const step = plan({ stage: 'CODE', stage_status: 'error' });
    assert.equal(step.action, 'blocked');
    assert.equal(step.reason, 'stage_error');
    assert.match(step.notes.join(' '), /эскалац|повтори/u);
  });

  test('неизвестная стадия — блокировка, а не догадка', () => {
    const step = plan({ stage: 'NOWHERE' });
    assert.equal(step.action, 'blocked');
    assert.equal(step.reason, 'unknown_stage');
  });
});

describe('planStep: контракт дескриптора', () => {
  test('действие всегда из списка, поля не undefined', () => {
    const step = plan({ stage: 'GATES' });
    assert.ok(STEP_ACTIONS.includes(step.action));
    for (const key of ['stage', 'status', 'action', 'reason', 'allowed_next', 'notes']) {
      assert.notEqual(/** @type {Record<string, unknown>} */ (step)[key], undefined, `поле ${key}`);
    }
    assert.ok(Array.isArray(step.allowed_next));
    assert.ok(Array.isArray(step.notes));
  });

  test('детерминизм: одинаковый вход — одинаковый выход', () => {
    const first = plan({ stage: 'REVIEW' }, { evidence: true });
    const second = plan({ stage: 'REVIEW' }, { evidence: true });
    assert.deepEqual(first, second);
  });

  test('исполняемыми считаются только run/advance/finish', () => {
    assert.equal(isExecutable(plan({ stage: 'GATES' })), true);
    assert.equal(isExecutable(plan({ stage: 'GATES', stage_status: 'done' })), true);
    assert.equal(isExecutable(plan({ stage: 'PLAN' })), false);
    assert.equal(isExecutable(plan({ stage: 'PR' })), false);
    assert.equal(
      isExecutable(plan({ stage: 'DONE', stage_status: 'running' }, { metrics: true })),
      false,
    );
  });

  test('describeStep называет стадию, действие и причину', () => {
    const text = describeStep(plan({ stage: 'GATES' }));
    assert.match(text, /^GATES\/running: run/u);
    assert.match(text, /gates_missing/u);
  });
});

describe('журнал драйвера: ожидание после шага', () => {
  test('advance обещает целевую стадию', () => {
    assert.deepEqual(expectedAfter(plan({ stage: 'GATES', stage_status: 'done' })), ['REVIEW']);
  });

  test('finish и spawn обещают ту же стадию', () => {
    assert.deepEqual(expectedAfter(plan({ stage: 'PLAN' }, { plan: true })), ['PLAN']);
    assert.deepEqual(expectedAfter(plan({ stage: 'PLAN' })), ['PLAN']);
  });

  test('handoff допускает и цели переходов: работу заканчивает супервизор', () => {
    assert.deepEqual(expectedAfter(plan({ stage: 'PR' })), ['PR', 'DONE']);
    assert.deepEqual(expectedAfter(plan({ stage: 'REWORK' })), ['REWORK', 'CODE']);
  });

  test('run без смены стадии обещает ту же стадию, apply-decision не обещает ничего', () => {
    assert.deepEqual(expectedAfter(plan({ stage: 'GATES' })), ['GATES']);
    assert.equal(expectedAfter(plan({ stage: 'DECIDE' }, { decision: true })), null);
  });

  test('терминальный stop и blocked ничего не обещают', () => {
    assert.equal(expectedAfter(plan({ stage: 'DONE' }, { metrics: true })), null);
    assert.equal(expectedAfter(plan({ stage: 'CODE', stage_status: 'error' })), null);
  });
});

describe('журнал драйвера: расхождение', () => {
  const advance = plan({ stage: 'GATES', stage_status: 'done' });

  test('состояние пришло в целевую стадию — расхождения нет', () => {
    const entry = buildJournalEntry({ step: advance, at: '2026-11-20T10:00:00Z', previous: null });
    assert.equal(mismatchAfter(entry, { stage: 'REVIEW' }), false);
  });

  test('состояние ушло в другую стадию — расхождение', () => {
    const entry = buildJournalEntry({ step: advance, at: '2026-11-20T10:00:00Z', previous: null });
    assert.equal(mismatchAfter(entry, { stage: 'CODE' }), true);
  });

  test('эскалация — штатный выход протокола, а не расхождение', () => {
    const entry = buildJournalEntry({ step: advance, at: '2026-11-20T10:00:00Z', previous: null });
    assert.equal(mismatchAfter(entry, { stage: 'ESCALATED' }), false);
  });

  test('без предыдущей записи сверять нечего', () => {
    assert.equal(mismatchAfter(null, { stage: 'CODE' }), false);
  });
});

describe('журнал драйвера: записи и сводка', () => {
  test('executed и mismatch проставляются по шагу и предыдущей записи', () => {
    const previous = buildJournalEntry({
      step: plan({ stage: 'PLAN' }),
      at: '2026-11-20T10:00:00Z',
      previous: null,
    });
    const entry = buildJournalEntry({
      step: plan({ stage: 'GATES' }),
      at: '2026-11-20T10:05:00Z',
      previous,
    });
    assert.equal(entry.executed, true);
    assert.equal(entry.stage, 'GATES');
    assert.equal(entry.mismatch, true, 'после PLAN пришли в GATES');
  });

  test('повторный ответ совпадает с предыдущим', () => {
    const step = plan({ stage: 'PLAN' });
    const first = buildJournalEntry({ step, at: '2026-11-20T10:00:00Z', previous: null });
    const second = buildJournalEntry({ step, at: '2026-11-20T10:01:00Z', previous: first });
    assert.equal(sameAnswer(second, first), true);
  });

  test('разные ответы не совпадают', () => {
    const first = buildJournalEntry({
      step: plan({ stage: 'PLAN' }),
      at: '2026-11-20T10:00:00Z',
      previous: null,
    });
    const second = buildJournalEntry({
      step: plan({ stage: 'PLAN' }, { plan: true }),
      at: '2026-11-20T10:01:00Z',
      previous: first,
    });
    assert.equal(sameAnswer(second, first), false);
  });

  test('parseJournal читает JSONL и пропускает пустые строки', () => {
    const line = JSON.stringify({
      at: '2026-11-20T10:00:00Z',
      stage: 'PLAN',
      status: 'running',
      action: 'spawn',
      step: null,
      target: null,
      reason: 'plan_missing',
      executed: false,
      mismatch: false,
    });
    const entries = parseJournal(`${line}\n\n${line}\n`);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.action, 'spawn');
  });

  test('битая строка журнала — отказ с номером строки', () => {
    const line = JSON.stringify({
      at: '2026-11-20T10:00:00Z',
      stage: 'PLAN',
      status: 'running',
      action: 'spawn',
      step: null,
      target: null,
      reason: 'plan_missing',
      executed: false,
      mismatch: false,
    });
    assert.throws(() => parseJournal(`${line}\nне json\n`), /строка 2/u);
  });

  test('запись без обязательного поля — отказ', () => {
    assert.throws(
      () => parseJournal(`${JSON.stringify({ stage: 'PLAN', status: 'running' })}\n`),
      /action/u,
    );
  });

  test('сводка считает шаги, исполнение, передачи и расхождения', () => {
    const entries = [
      { action: 'run', executed: true, mismatch: false },
      { action: 'advance', executed: true, mismatch: false },
      { action: 'spawn', executed: false, mismatch: false },
      { action: 'handoff', executed: false, mismatch: true },
    ].map((entry) => ({
      at: '2026-11-20T10:00:00Z',
      stage: 'PLAN',
      status: 'running',
      step: null,
      target: null,
      reason: 'test',
      ...entry,
    }));
    assert.deepEqual(summarizeJournal(entries), {
      steps: 4,
      executed: 2,
      handed_off: 2,
      mismatch: 1,
    });
  });

  test('пустой журнал — нули, а не отсутствие полей', () => {
    assert.deepEqual(summarizeJournal([]), {
      steps: 0,
      executed: 0,
      handed_off: 0,
      mismatch: 0,
    });
  });
});

describe('planStep: переход только по таблице §5.3', () => {
  const STATUSES = ['running', 'done', 'error'];
  const FLAGS = [
    'criteria',
    'plan',
    'codeReport',
    'gates',
    'qaWeb',
    'evidence',
    'review',
    'evaluation',
    'decision',
    'reworkBrief',
    'metrics',
    'lock',
  ];

  test('advance ведёт только в allowed_next — на всех стадиях и состояниях', () => {
    for (const stage of STAGES) {
      for (const status of STATUSES) {
        for (const flag of FLAGS) {
          const step = plan({ stage, stage_status: status }, { [flag]: true });
          if (step.action !== 'advance') continue;
          assert.ok(
            step.allowed_next.includes(/** @type {string} */ (step.target)),
            `${stage}/${status}/${flag}: target ${step.target} вне allowed_next`,
          );
          assert.ok(
            advanceTargets(stage).includes(/** @type {string} */ (step.target)),
            `${stage}/${status}/${flag}: target ${step.target} вне таблицы переходов`,
          );
        }
      }
    }
  });

  test('стадия из таблицы никогда не остаётся без перехода', () => {
    // DECIDE закрытым не бывает: его закрывает `apply-decision`, а не `finish` (§5.3).
    for (const stage of STAGES.filter((name) => name !== 'DECIDE')) {
      const step = plan({ stage, stage_status: 'done' });
      assert.notEqual(step.action, 'blocked', `${stage}: нет перехода после закрытой стадии`);
    }
  });
});

describe('контракт вывода next: состояние цикла и «что сделано» (#151)', () => {
  test('CONTRACT_ID называет контракт и версию', () => {
    assert.match(CONTRACT_ID, /^cycle-driver\.next\/\d+$/u);
  });

  test('cycleSnapshot переносит поля state.json как есть', () => {
    const snapshot = cycleSnapshot(
      {
        issue: 152,
        branch: 'feat/152-driver',
        iteration: 2,
        max_iterations: 3,
        stage: 'REVIEW',
        stage_status: 'done',
        owner_approved: true,
        escalation: { reason: 'budget', draft_pr: null },
      },
      '/tmp/cycle',
    );

    assert.deepEqual(snapshot, {
      issue: 152,
      branch: 'feat/152-driver',
      dir: '/tmp/cycle',
      iteration: 2,
      max_iterations: 3,
      stage: 'REVIEW',
      stage_status: 'done',
      owner_approved: true,
      escalation: { reason: 'budget', draft_pr: null },
    });
  });

  test('cycleSnapshot не выдумывает значения: нет поля — null', () => {
    const snapshot = cycleSnapshot({ iteration: 1, stage: 'INIT', stage_status: 'running' }, 'd');
    assert.equal(snapshot.issue, null);
    assert.equal(snapshot.branch, '');
    assert.equal(snapshot.max_iterations, null);
    assert.equal(snapshot.owner_approved, null);
    assert.equal(snapshot.escalation, null);
  });

  test('doneStages отдаёт последние этапы в порядке файла и не растёт с историей', () => {
    const history = Array.from({ length: 14 }, (_, index) => ({
      stage: index === 13 ? 'CODE' : 'PLAN',
      iteration: 1,
      status: index === 13 ? 'running' : 'done',
      started_at: '2026-11-20T10:00:00Z',
      finished_at: index === 13 ? null : '2026-11-20T10:01:00Z',
    }));

    const stages = doneStages({ iteration: 1, history }, 10);
    assert.equal(stages.length, 10);
    assert.equal(stages.at(-1)?.stage, 'CODE');
    assert.equal(stages.at(-1)?.finished_at, null);
    assert.ok(
      stages.every((entry) =>
        ['stage', 'iteration', 'status', 'finished_at'].every((key) => key in entry),
      ),
    );
  });

  test('doneStages пропускает мусор в истории, а не падает', () => {
    const stages = doneStages({
      iteration: 2,
      history: [null, 'мусор', { stage: 'PLAN', status: 'done' }, { status: 'done' }],
    });
    assert.deepEqual(stages, [{ stage: 'PLAN', iteration: 2, status: 'done', finished_at: null }]);
  });

  test('нет истории — пустой список, а не ошибка', () => {
    assert.deepEqual(doneStages({ iteration: 1 }), []);
  });
});
