import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { REPO_ONLY } from './lib/testsupport.mjs';
import { loadConfig } from './lib/cycle/config.mjs';
import {
  AGENT_NAMES,
  STAGES,
  analyzeHarness,
  evaluateHarness,
  familyOf,
  findModelIdentifiers,
  formatViolation,
  formatWarning,
  harnessWarnings,
  parseFrontmatter,
} from './check-harness.mjs';

/** Путь к CLI: тесты запускают его как отдельный процесс. */
const SCRIPT = fileURLToPath(new URL('./check-harness.mjs', import.meta.url));

/** Корень репозитория: `REPO_ONLY`-тест проверяет настоящую раскладку `.pi/`. */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Корень фикстур harness: `scripts/fixtures/harness/`. */
const FIXTURES = fileURLToPath(new URL('./fixtures/harness/', import.meta.url));

/** Текст с именами всех этапов автомата: база для «соблюдено» по H6. */
const ALL_STAGES_TEXT = STAGES.join(' → ');

/**
 * @typedef {{ name: string, file: string, fields: Record<string, string | string[]> | null }} AgentDoc
 *   `fields === null` — файла агента нет (нарушение H1).
 * @typedef {{ agents: AgentDoc[], settings: unknown, cycleText: string, agentsMdText: string }} HarnessInput
 */

/**
 * Запускает CLI и возвращает код, stdout и stderr.
 * @param {string[]} args
 * @param {{ cwd?: string }} [options] рабочий каталог — без `--root` проверяется именно он (#42)
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: options.cwd,
  });
  assert.equal(result.error, undefined);
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Строки stdout без завершающего перевода строки.
 * @param {string} stdout
 * @returns {string[]}
 */
function lines(stdout) {
  return stdout === '' ? [] : stdout.replace(/\n$/, '').split('\n');
}

/**
 * Копия фикстуры во временном каталоге: тесты меняют файлы, не трогая репозиторий.
 * @param {import('node:test').TestContext} t
 * @param {string} fixture имя каталога в `scripts/fixtures/harness/`
 * @returns {string} корень копии
 */
function copyFixture(t, fixture) {
  const root = mkdtempSync(join(tmpdir(), 'harness-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(FIXTURES, fixture), root, { recursive: true });
  return root;
}

/**
 * Агент для синтетических входов `evaluateHarness`. Семейство по умолчанию — имя агента,
 * то есть у всех четырёх агентов семейства различны.
 * @param {string} name
 * @param {Record<string, string | string[]>} [fields] переопределения полей frontmatter
 * @returns {AgentDoc}
 */
function agent(name, fields = {}) {
  return {
    name,
    file: `.pi/agents/${name}.md`,
    fields: { name, model: `acme-ai/${name}/m-1`, thinking: 'low', tools: ['read'], ...fields },
  };
}

/**
 * Вход проверки: комплект «всё соблюдено».
 * @param {Partial<HarnessInput>} overrides
 * @returns {HarnessInput}
 */
function harness(overrides = {}) {
  return {
    agents: AGENT_NAMES.map((name) => agent(name)),
    settings: { subagents: { maxSubagentSpawnsPerRun: 7 } },
    cycleText: ALL_STAGES_TEXT,
    agentsMdText: 'Текст без идентификаторов моделей: Claude Code допустим.',
    ...overrides,
  };
}

/**
 * Нарушения в виде готовых строк вывода.
 * @param {HarnessInput} input
 * @returns {string[]}
 */
function report(input) {
  return evaluateHarness(input).map(formatViolation);
}

/**
 * Предупреждения в виде готовых строк stderr.
 * @param {HarnessInput} input
 * @returns {string[]}
 */
function warn(input) {
  return harnessWarnings(input).map(formatWarning);
}

/** Строка W2 для входа `harness()` с указанной моделью `evaluate`. */
const W2_PLAN_FAMILY =
  'W2: .pi/agents/evaluate.md — семейство модели совпадает с plan: plan' +
  ' (риск I3, docs/orchestrator.md §18 — ребро не проверяется)';

/**
 * Агенты без указанных имён: имитирует отсутствие файлов.
 * @param {string[]} names
 * @returns {(name: string) => AgentDoc}
 */
function without(names) {
  return (name) =>
    names.includes(name) ? { name, file: `.pi/agents/${name}.md`, fields: null } : agent(name);
}

describe('parseFrontmatter', () => {
  test('разбирает key: value, кавычки и список tools', () => {
    const parsed = parseFrontmatter(
      [
        '---',
        'name: plan',
        "description: 'Планирование: без правок.'",
        'model: "acme-ai/alpha/a-1"',
        'tools: read, grep, find, ls',
        '---',
        '',
        'Тело агента.',
      ].join('\n'),
    );

    assert.deepEqual(parsed, {
      ok: true,
      fields: {
        name: 'plan',
        description: 'Планирование: без правок.',
        model: 'acme-ai/alpha/a-1',
        tools: ['read', 'grep', 'find', 'ls'],
      },
    });
  });

  test('пустой список tools — пустой массив, а не строка', () => {
    const parsed = parseFrontmatter('---\nname: plan\ntools:\n---\n');
    assert.deepEqual(parsed, { ok: true, fields: { name: 'plan', tools: [] } });
  });

  test('нет открывающей строки --- — ошибка', () => {
    const parsed = parseFrontmatter('name: plan\n---\n');
    assert.equal(parsed.ok, false);
  });

  test('нет закрывающей строки --- — ошибка', () => {
    const parsed = parseFrontmatter('---\nname: plan\n');
    assert.equal(parsed.ok, false);
  });

  test('строка не вида key: value — ошибка', () => {
    const parsed = parseFrontmatter('---\nname plan\n---\n');
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /строка 2/);
    }
  });
});

describe('familyOf', () => {
  test('семейство — второй сегмент model', () => {
    assert.equal(familyOf('acme-ai/alpha/a-1'), 'alpha');
  });

  test('без префикса провайдера семейство не вычислимо', () => {
    assert.equal(familyOf('alpha/a-1'), null);
  });

  test('один сегмент после провайдера — семейства нет', () => {
    assert.equal(familyOf('acme-ai/alpha'), null);
  });
});

describe('H1: агенты и обязательные поля', () => {
  test('соблюдено: все четыре агента с полями', () => {
    assert.deepEqual(report(harness()), []);
  });

  test('нарушено: нет агента evaluate', () => {
    assert.deepEqual(report(harness({ agents: AGENT_NAMES.map(without(['evaluate'])) })), [
      'H1: .pi/agents/evaluate.md — агент отсутствует',
    ]);
  });

  test('нарушено: name не совпадает с именем файла', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'plan' ? agent('plan', { name: 'planner' }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H1: .pi/agents/plan.md — name "planner" не совпадает с именем файла "plan"',
    ]);
  });

  test('нарушено: поля thinking и tools не заданы', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'review' ? agent('review', { thinking: '', tools: [] }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H1: .pi/agents/review.md — не заданы поля: thinking, tools',
    ]);
  });

  test('нарушено: нет всех четырёх агентов — четыре строки в порядке §5.9', () => {
    const agents = AGENT_NAMES.map((name) => ({
      name,
      file: `.pi/agents/${name}.md`,
      fields: null,
    }));
    assert.deepEqual(report(harness({ agents })), [
      'H1: .pi/agents/plan.md — агент отсутствует',
      'H1: .pi/agents/code.md — агент отсутствует',
      'H1: .pi/agents/review.md — агент отсутствует',
      'H1: .pi/agents/evaluate.md — агент отсутствует',
    ]);
  });
});

describe('H2: независимость семейств', () => {
  test('соблюдено: code, review и evaluate в разных семействах', () => {
    assert.deepEqual(report(harness()), []);
  });

  test('нарушено: review в семействе code', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'review' ? agent('review', { model: 'acme-ai/code/m-9' }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H2: .pi/agents/code.md — семейство модели совпадает с review: code',
    ]);
  });

  test('нарушено: evaluate в семействе code', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'evaluate' ? agent('evaluate', { model: 'acme-ai/code/m-9' }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H2: .pi/agents/evaluate.md — семейство модели совпадает с code: code',
    ]);
  });

  test('нарушено: evaluate в семействе review', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'evaluate' ? agent('evaluate', { model: 'acme-ai/review/m-9' }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H2: .pi/agents/evaluate.md — семейство модели совпадает с review: review',
    ]);
  });

  test('отсутствующий evaluate не даёт ложный H2', () => {
    const agents = AGENT_NAMES.map(without(['evaluate']));
    assert.deepEqual(report(harness({ agents })), [
      'H1: .pi/agents/evaluate.md — агент отсутствует',
    ]);
  });

  test('невычислимое семейство разбирает H4, а не H2', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'code'
        ? agent('code', { model: 'code/m-1' })
        : name === 'review'
          ? agent('review', { model: 'code/m-2' })
          : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H4: .pi/agents/code.md — model не начинается с acme-ai/: code/m-1',
      'H4: .pi/agents/review.md — model не начинается с acme-ai/: code/m-2',
    ]);
  });
});

describe('W2: ребро evaluate↔plan не проверяется, но видно', () => {
  test('соблюдено: evaluate и plan в разных семействах — предупреждения нет', () => {
    assert.deepEqual(warn(harness()), []);
  });

  test('предупреждение: evaluate в семействе plan, нарушения нет', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'evaluate' ? agent('evaluate', { model: 'acme-ai/plan/m-9' }) : agent(name),
    );
    const input = harness({ agents });
    assert.deepEqual(report(input), []);
    assert.deepEqual(warn(input), [W2_PLAN_FAMILY]);
  });

  test('предупреждение: plan в семействе evaluate — факт симметричен', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'plan' ? agent('plan', { model: 'acme-ai/evaluate/m-9' }) : agent(name),
    );
    assert.deepEqual(warn(harness({ agents })), [
      'W2: .pi/agents/evaluate.md — семейство модели совпадает с plan: evaluate' +
        ' (риск I3, docs/orchestrator.md §18 — ребро не проверяется)',
    ]);
  });

  test('одно ребро не даёт двух нарушений H2 по тому же файлу', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'evaluate'
        ? agent('evaluate', { model: 'acme-ai/code/m-9' })
        : name === 'plan'
          ? agent('plan', { model: 'acme-ai/code/m-9' })
          : agent(name),
    );
    const input = harness({ agents });
    assert.deepEqual(report(input), [
      'H2: .pi/agents/evaluate.md — семейство модели совпадает с code: code',
    ]);
    assert.equal(warn(input).length, 1);
  });

  test('невычислимое семейство не даёт ложного W2', () => {
    const agents = AGENT_NAMES.map((name) => {
      if (name === 'plan') return agent('plan', { model: 'acme-ai/planz/m-1' });
      if (name === 'evaluate') return agent('evaluate', { model: 'planz/m-2' });
      return agent(name);
    });
    assert.deepEqual(warn(harness({ agents })), []);
  });

  test('отсутствующий plan не даёт W2', () => {
    const agents = AGENT_NAMES.map(without(['plan']));
    assert.deepEqual(warn(harness({ agents })), []);
  });

  test('analyzeHarness возвращает нарушения и предупреждения одним проходом', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'evaluate'
        ? agent('evaluate', { model: 'acme-ai/plan/m-9', tools: ['read', 'write'] })
        : agent(name),
    );
    const result = analyzeHarness(harness({ agents }));
    assert.deepEqual(result.violations.map(formatViolation), [
      'H3: .pi/agents/evaluate.md — запрещённые инструменты: write',
    ]);
    assert.deepEqual(result.warnings.map(formatWarning), [W2_PLAN_FAMILY]);
  });
});

describe('H3: запрещённые инструменты', () => {
  test('соблюдено: plan без bash/edit/write, review и evaluate без edit/write', () => {
    assert.deepEqual(report(harness()), []);
  });

  test('нарушено: у plan есть bash', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'plan' ? agent('plan', { tools: ['read', 'bash'] }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H3: .pi/agents/plan.md — запрещённые инструменты: bash',
    ]);
  });

  test('нарушено: у review есть edit и write', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'review' ? agent('review', { tools: ['read', 'edit', 'write'] }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H3: .pi/agents/review.md — запрещённые инструменты: edit, write',
    ]);
  });

  test('нарушено: у evaluate есть write', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'evaluate' ? agent('evaluate', { tools: ['read', 'write'] }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H3: .pi/agents/evaluate.md — запрещённые инструменты: write',
    ]);
  });

  test('code может иметь bash, edit и write', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'code' ? agent('code', { tools: ['read', 'bash', 'edit', 'write'] }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), []);
  });
});

describe('H4: провайдер моделей', () => {
  test('соблюдено: все model через acme-ai/', () => {
    assert.deepEqual(report(harness()), []);
  });

  test('нарушено: model без префикса', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'plan' ? agent('plan', { model: 'alpha/a-1' }) : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H4: .pi/agents/plan.md — model не начинается с acme-ai/: alpha/a-1',
    ]);
  });

  test('нарушено: два агента не на acme-ai/ — порядок plan, code', () => {
    const agents = AGENT_NAMES.map((name) =>
      name === 'plan'
        ? agent('plan', { model: 'openai/alpha/a-1' })
        : name === 'code'
          ? agent('code', { model: 'openai/beta/b-2' })
          : agent(name),
    );
    assert.deepEqual(report(harness({ agents })), [
      'H4: .pi/agents/plan.md — model не начинается с acme-ai/: openai/alpha/a-1',
      'H4: .pi/agents/code.md — model не начинается с acme-ai/: openai/beta/b-2',
    ]);
  });
});

describe('H5: лимит запусков субагентов', () => {
  test('соблюдено: ровно 7', () => {
    assert.deepEqual(report(harness()), []);
  });

  test('соблюдено: больше 7', () => {
    assert.deepEqual(
      report(harness({ settings: { subagents: { maxSubagentSpawnsPerRun: 12 } } })),
      [],
    );
  });

  test('нарушено: 5', () => {
    assert.deepEqual(report(harness({ settings: { subagents: { maxSubagentSpawnsPerRun: 5 } } })), [
      'H5: .pi/settings.json — subagents.maxSubagentSpawnsPerRun = 5, требуется ≥ 7',
    ]);
  });

  test('нарушено: поле не задано', () => {
    assert.deepEqual(report(harness({ settings: { subagents: {} } })), [
      'H5: .pi/settings.json — subagents.maxSubagentSpawnsPerRun не задан',
    ]);
  });

  test('нарушено: не целое число', () => {
    assert.deepEqual(
      report(harness({ settings: { subagents: { maxSubagentSpawnsPerRun: 'семь' } } })),
      ['H5: .pi/settings.json — subagents.maxSubagentSpawnsPerRun должен быть целым: "семь"'],
    );
  });
});

describe('H6: имена этапов и идентификаторы моделей', () => {
  test('в §5.3 тринадцать этапов', () => {
    assert.equal(STAGES.length, 13);
  });

  test('соблюдено: cycle.md содержит все этапы, AGENTS.md без моделей', () => {
    assert.deepEqual(report(harness()), []);
  });

  test('нарушено: в cycle.md нет ни одного этапа', () => {
    assert.deepEqual(report(harness({ cycleText: 'Этапы: plan → code → review.' })), [
      'H6: .pi/prompts/cycle.md — нет имён этапов: ' +
        'INIT, GATES, QA_WEB, EVALUATE, DECIDE, REWORK, ACQUIRE_EVIDENCE, PR, DONE, ESCALATED',
    ]);
  });

  test('нарушено: нет одного этапа', () => {
    const text = STAGES.filter((stage) => stage !== 'QA_WEB').join(' → ');
    assert.deepEqual(report(harness({ cycleText: text })), [
      'H6: .pi/prompts/cycle.md — нет имён этапов: QA_WEB',
    ]);
  });

  test('имена этапов ищутся без учёта регистра', () => {
    const text = STAGES.join(' → ').toLowerCase();
    assert.deepEqual(report(harness({ cycleText: text })), []);
  });

  test('нарушено: идентификаторы моделей в AGENTS.md', () => {
    assert.deepEqual(report(harness({ agentsMdText: 'Модели: DeepSeek v4.1, GLM-5.3, GPT-6.' })), [
      'H6: AGENTS.md — идентификаторы моделей: DeepSeek, GLM-5, GPT-6',
    ]);
  });

  test('«Claude Code» нарушением не считается', () => {
    assert.deepEqual(
      report(harness({ agentsMdText: 'Единый источник правил для Claude Code и pi.' })),
      [],
    );
  });

  test('«claude-opus» считается идентификатором модели', () => {
    assert.deepEqual(report(harness({ agentsMdText: 'Ревьюер — claude-opus.' })), [
      'H6: AGENTS.md — идентификаторы моделей: claude-opus',
    ]);
  });

  test('провайдер acme-ai/ в AGENTS.md — идентификатор', () => {
    assert.deepEqual(report(harness({ agentsMdText: 'Провайдер acme-ai/ по умолчанию.' })), [
      'H6: AGENTS.md — идентификаторы моделей: acme-ai/',
    ]);
  });

  test('повторы одного идентификатора не дублируются', () => {
    assert.deepEqual(findModelIdentifiers('DeepSeek и deepseek, GPT-6 и gpt-7'), [
      'DeepSeek',
      'GPT-6',
      'gpt-7',
    ]);
  });

  test('порядок вывода: H1→H6, внутри H6 сначала cycle.md, затем AGENTS.md', () => {
    const agents = AGENT_NAMES.map(without(['evaluate']));
    assert.deepEqual(
      report(
        harness({
          agents,
          cycleText: 'Этапы: INIT → PLAN → CODE.',
          agentsMdText: 'Модель GPT-6.',
        }),
      ),
      [
        'H1: .pi/agents/evaluate.md — агент отсутствует',
        'H6: .pi/prompts/cycle.md — нет имён этапов: ' +
          'GATES, QA_WEB, REVIEW, EVALUATE, DECIDE, REWORK, ACQUIRE_EVIDENCE, PR, DONE, ESCALATED',
        'H6: AGENTS.md — идентификаторы моделей: GPT-6',
      ],
    );
  });
});

describe('CLI на фикстурных деревьях', () => {
  /** Ожидания e2e: точный код выхода и точный список строк stdout. */
  const CASES = [
    { fixture: 'ok', code: 0, expected: [] },
    {
      fixture: 'h1-missing-agent',
      code: 1,
      expected: ['H1: .pi/agents/evaluate.md — агент отсутствует'],
    },
    {
      fixture: 'h1-invalid-fields',
      code: 1,
      expected: [
        'H1: .pi/agents/plan.md — name "planner" не совпадает с именем файла "plan"',
        'H1: .pi/agents/review.md — не заданы поля: thinking, tools',
      ],
    },
    {
      fixture: 'h2-family',
      code: 1,
      expected: ['H2: .pi/agents/code.md — семейство модели совпадает с review: beta'],
    },
    {
      fixture: 'h3-tools',
      code: 1,
      expected: [
        'H3: .pi/agents/plan.md — запрещённые инструменты: bash',
        'H3: .pi/agents/review.md — запрещённые инструменты: edit',
      ],
    },
    {
      fixture: 'h4-model',
      code: 1,
      expected: ['H4: .pi/agents/plan.md — model не начинается с acme-ai/: alpha/a-1'],
    },
    {
      fixture: 'h5-spawns',
      code: 1,
      expected: ['H5: .pi/settings.json — subagents.maxSubagentSpawnsPerRun = 5, требуется ≥ 7'],
    },
    {
      fixture: 'h6-cycle',
      code: 1,
      expected: [
        'H6: .pi/prompts/cycle.md — нет имён этапов: ' +
          'GATES, QA_WEB, EVALUATE, DECIDE, REWORK, ACQUIRE_EVIDENCE, PR, DONE, ESCALATED',
      ],
    },
    {
      fixture: 'h6-agents-md',
      code: 1,
      expected: ['H6: AGENTS.md — идентификаторы моделей: DeepSeek, GPT-6'],
    },
  ];

  for (const item of CASES) {
    test(`фикстура ${item.fixture}: код ${item.code}, ${item.expected.length} строк(и)`, () => {
      const result = runCli(['--root', join(FIXTURES, item.fixture)]);
      assert.equal(result.stderr, '');
      assert.deepEqual(lines(result.stdout), item.expected);
      assert.equal(result.code, item.code);
    });
  }

  test('вывод детерминирован: два запуска совпадают побайтно', () => {
    const root = join(FIXTURES, 'h6-agents-md');
    assert.equal(runCli(['--root', root]).stdout, runCli(['--root', root]).stdout);
  });

  test('без --root проверяется текущий каталог: в репозитории — его корень', REPO_ONLY, () => {
    const result = runCli([]);
    assert.ok(result.code === 0 || result.code === 1);
    for (const line of lines(result.stdout)) {
      assert.match(line, /^H[1-6]: \S+/);
    }
    // Действующая конфигурация держит evaluate и plan в одном семействе (риск I3):
    // проверка это видит, печатает предупреждением и не падает.
    const provider = loadConfig(REPO_ROOT).provider;
    /** @param {string} agent имя роли */
    const family = (agent) =>
      familyOf(
        /^model: (\S+)$/mu.exec(
          readFileSync(join(REPO_ROOT, '.pi/agents', `${agent}.md`), 'utf8'),
        )?.[1],
        provider,
      );
    if (family('evaluate') === family('plan')) {
      assert.match(result.stderr, /^W2: \.pi\/agents\/evaluate\.md — /mu);
    } else {
      assert.equal(result.stderr, '');
    }
  });

  test('W2 на фикстуре: код 0, пустой stdout, предупреждение в stderr', (t) => {
    const root = copyFixture(t, 'ok');
    const evaluateFile = join(root, '.pi', 'agents', 'evaluate.md');
    const planModel = /^model: (\S+)$/mu.exec(
      readFileSync(join(root, '.pi', 'agents', 'plan.md'), 'utf8'),
    )?.[1];
    assert.ok(planModel !== undefined, 'в фикстуре ok у plan есть model');
    writeFileSync(
      evaluateFile,
      readFileSync(evaluateFile, 'utf8').replace(/^model: \S+$/mu, `model: ${planModel}`),
    );

    const result = runCli(['--root', root]);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'W2: .pi/agents/evaluate.md — семейство модели совпадает с plan: alpha' +
        ' (риск I3, docs/orchestrator.md §18 — ребро не проверяется)\n',
    );
  });

  test('на фикстуре без совпадения ребра stderr пуст', () => {
    const result = runCli(['--root', join(FIXTURES, 'ok')]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
  });

  test('без --root проверяется cwd, а не каталог пакета (#42)', (t) => {
    const ok = copyFixture(t, 'ok');
    const clean = runCli([], { cwd: ok });
    assert.equal(clean.code, 0, clean.stderr);
    assert.equal(clean.stdout, '');

    const broken = copyFixture(t, 'h2-family');
    const drift = runCli([], { cwd: broken });
    assert.equal(drift.code, 1);
    assert.deepEqual(lines(drift.stdout), [
      'H2: .pi/agents/code.md — семейство модели совпадает с review: beta',
    ]);
  });

  test('--root сильнее cwd', (t) => {
    const ok = copyFixture(t, 'ok');
    const broken = join(FIXTURES, 'h2-family');

    const result = runCli(['--root', broken], { cwd: ok });

    assert.equal(result.code, 1);
    assert.deepEqual(lines(result.stdout), [
      'H2: .pi/agents/code.md — семейство модели совпадает с review: beta',
    ]);
  });

  test('нет файла: код 2 и нет абсолютного пути в stderr', (t) => {
    const root = copyFixture(t, 'ok');
    rmSync(join(root, 'AGENTS.md'));
    const result = runCli(['--root', root]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /AGENTS\.md — файл не найден/);
    assert.ok(!result.stderr.includes(root), 'stderr не должен содержать путь к корню');
    assert.ok(!result.stderr.includes('--root'), 'stderr не должен повторять аргумент --root');
  });

  test('отсутствующий корень: код 2, диагностика без абсолютного пути', (t) => {
    const root = join(mkdtempSync(join(tmpdir(), 'harness-check-gone-')), 'root');
    t.after(() => rmSync(dirname(root), { recursive: true, force: true }));
    const result = runCli(['--root', root]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'check-harness: .pi/settings.json — файл не найден\n');
    assert.ok(!result.stderr.includes(root));
    assert.ok(!result.stderr.includes('--root'));
  });

  test('битый JSON в settings.json: код 2', (t) => {
    const root = copyFixture(t, 'ok');
    writeFileSync(join(root, '.pi', 'settings.json'), '{ "subagents": {');
    const result = runCli(['--root', root]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\.pi\/settings\.json — битый JSON/);
    assert.ok(!result.stderr.includes(root));
  });

  test('битый JSON с путём в тексте файла: путь не попадает в stderr', (t) => {
    const root = copyFixture(t, 'ok');
    writeFileSync(join(root, '.pi', 'settings.json'), '/tmp/leaked-settings/x');
    const result = runCli(['--root', root]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\.pi\/settings\.json — битый JSON: Unexpected token/);
    assert.ok(!result.stderr.includes('/tmp/leaked-settings'));
    assert.ok(!result.stderr.includes(root));
  });

  test('битый frontmatter агента: код 2', (t) => {
    const root = copyFixture(t, 'ok');
    writeFileSync(
      join(root, '.pi', 'agents', 'plan.md'),
      '---\nname: plan\nmodel: acme-ai/alpha/a-1\n',
    );
    const result = runCli(['--root', root]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\.pi\/agents\/plan\.md — битый frontmatter/);
  });

  test('--root без пути: код 2', () => {
    const result = runCli(['--root']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--root: ожидается путь/);
  });

  test('неизвестный аргумент: код 2', () => {
    const result = runCli(['--unknown']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /неизвестный аргумент: --unknown/);
  });
});

describe('check-harness: профиль раскладки (#80)', () => {
  /**
   * Копия фикстуры `ok`, перенесённая на профиль `harness/**`: пути в конфиге, файлы — по путям.
   * @param {import('node:test').TestContext} t
   * @returns {string}
   */
  function customProfile(t) {
    const root = copyFixture(t, 'ok');
    mkdirSync(join(root, 'harness'), { recursive: true });
    renameSync(join(root, '.pi/agents'), join(root, 'harness/agents'));
    renameSync(join(root, '.pi/settings.json'), join(root, 'harness/settings.json'));
    renameSync(join(root, '.pi/prompts/cycle.md'), join(root, 'harness/cycle.md'));
    rmSync(join(root, '.pi/prompts'), { recursive: true, force: true });
    writeFileSync(
      join(root, '.pi/harness.config.json'),
      `${JSON.stringify(
        {
          provider: 'acme-ai/',
          paths: {
            agentsDir: 'harness/agents',
            settings: 'harness/settings.json',
            cyclePrompt: 'harness/cycle.md',
          },
        },
        null,
        2,
      )}\n`,
    );
    return root;
  }

  /**
   * Файл из строки вывода: `H1: <файл> — сообщение`.
   * @param {string} line
   * @returns {string}
   */
  function fileOf(line) {
    const head = line.split(' — ')[0] ?? line;
    return head.split(': ').slice(1).join(': ');
  }

  test('читает файлы по путям профиля, а не по умолчаниям', (t) => {
    const root = customProfile(t);

    const result = runCli(['--root', root]);
    assert.equal(result.code, 0, `дерево по профилю должно быть зелёным: ${result.stdout}`);
  });

  test('называет фактические пути профиля и держит порядок профиля', (t) => {
    const root = customProfile(t);
    rmSync(join(root, 'harness/agents/plan.md'));
    writeFileSync(
      join(root, 'harness/settings.json'),
      `${JSON.stringify({ subagents: { maxSubagentSpawnsPerRun: 3 } }, null, 2)}\n`,
    );
    writeFileSync(join(root, 'harness/cycle.md'), 'ни одного этапа автомата\n');
    writeFileSync(join(root, 'AGENTS.md'), '# Проект\n\nМодель gpt-6-luna в прозе.\n');

    const result = runCli(['--root', root]);
    assert.equal(result.code, 1);
    assert.ok(!result.stdout.includes('.pi/'), 'вывод не должен ссылаться на умолчания ядра');

    assert.deepEqual(lines(result.stdout).map(fileOf), [
      'harness/agents/plan.md',
      'harness/settings.json',
      'harness/cycle.md',
      'AGENTS.md',
    ]);
  });

  test('analyzeHarness без профиля работает по умолчаниям ядра', () => {
    const { violations } = analyzeHarness({
      agents: AGENT_NAMES.map((name) => ({ name, file: `.pi/agents/${name}.md`, fields: null })),
      settings: { subagents: { maxSubagentSpawnsPerRun: 1 } },
      cycleText: 'ничего',
      agentsMdText: 'gpt-6-luna',
    });

    assert.deepEqual(
      violations.map((violation) => violation.file),
      [
        '.pi/agents/plan.md',
        '.pi/agents/code.md',
        '.pi/agents/review.md',
        '.pi/agents/evaluate.md',
        '.pi/settings.json',
        '.pi/prompts/cycle.md',
        'AGENTS.md',
      ],
    );
  });
});
