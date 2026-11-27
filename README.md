# @dnikulshin/harness

[![CI](https://github.com/DNikulshin/dev-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/DNikulshin/dev-harness/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dnikulshin/harness)](https://www.npmjs.com/package/@dnikulshin/harness)
[![Node](https://img.shields.io/badge/node-%3E%3D26.13-informational)](./.nvmrc)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-dnikulshin.ru%2Fdev--harness-informational)](https://dnikulshin.ru/dev-harness/)

**English** · [Русская версия](./README.ru.md)

A reusable development-cycle core: deterministic scripts for
`plan → code → gates → review → evaluate → decide`, the artifact schema behind them, a
harness-layout check, and an evals layer.

The core knows nothing about a specific project. Gates, limits, paths and the model provider come
from the project's `.pi/harness.config.json`; roles and prohibitions live in the project's
`AGENTS.md`.

**Status:** v0.3.0, published on npm. What counts as public API and how a breaking change is
announced — [docs/release.md](./docs/release.md).

CLI messages are in Russian in every version up to and including 0.3.0. The output below is copied
from real runs on a new project; where a block is pretty-printed or shortened, the text says so.

## Requirements

- **Node.js 26.13 or newer** — `engines.node` = `>=26.13`, `.nvmrc` = `26.13.1`; CI runs on that
  version, and no upper bound is declared: a version CI does not run promises nothing.
- **Linux or macOS** — `os: ["linux", "darwin"]` in `package.json`; CI runs the same steps on
  `ubuntu-latest` and `macos-latest`. **Windows is not supported:** a gate timeout kills not only
  the process but its children through the process group (`detached: true` + `process.kill(-pid)`,
  §5.5 of `docs/orchestrator-core.md`), and process groups work differently on Windows — a gate with
  no guarantee that children die is worse than an explicit refusal to install.
- **git** (the diff from `base_sha`), **pnpm** for the project's `pnpm` commands (version from
  `packageManager`) and the **gh** CLI for board and branch-hygiene commands. These are requirements
  of the commands, not of the package: the core calls `git` and `node` only and fetches nothing from
  the network.

## Why

Several projects need the same cycle. A copy of the core in every repository drifts and is fixed
several times over. A separate repository keeps the mechanism shared and leaves policy to the
project. More on this — [docs/vision.md](./docs/vision.md).

## Quick start

The core is installed **as a package**, not by copying files: a copy would reproduce exactly the
duplication problem the core was extracted for. The main path is the npm registry:

```bash
npx @dnikulshin/harness init      # templates, example config, layout check
pnpm add -D @dnikulshin/harness   # package commands come from devDependencies
```

`npx` works without installing anything: the package is downloaded for the run, and the project is
unchanged apart from the files created. From then on commands run as `pnpm exec harness-init`,
`pnpm exec harness-cycle-gates` and so on (`bin` entries are listed below).

For a pilot there is also a git reference — the same code without the registry, pinned by tag:

```json
{
  "devDependencies": {
    "@dnikulshin/harness": "github:DNikulshin/dev-harness#v0.3.0"
  }
}
```

The repository is public: no token is needed to install from the registry or from the git reference.

### 1. `harness init` — templates and config

Run it in the project root, with `AGENTS.md` already in place (without it the command installs the
templates but skips the layout check and says so):

```bash
npx @dnikulshin/harness init
```

With `AGENTS.md` in place:

```text
создан: .pi/agents/code.md
создан: .pi/agents/evaluate.md
создан: .pi/agents/plan.md
создан: .pi/agents/review.md
создан: .pi/harness.config.json
создан: .pi/prompts/cycle.md
создан: .pi/settings.json (subagents.maxSubagentSpawnsPerRun = 7)
записан: .pi/harness.version (версия 0.3.0)
W2: .pi/agents/evaluate.md — семейство модели совпадает с plan: z-ai (принятый риск I3, ребро не проверяется, действий не требуется; docs/orchestrator.md §18)
проверка раскладки: нарушений нет, предупреждений 1 (информационные — действий не требуется)
проверить отдельно: harness-check-layout --root .
```

Without `AGENTS.md` the layout check is skipped and the command says why:

```text
проверка раскладки не выполнена: нет AGENTS.md — создайте его
проверить отдельно: harness-check-layout --root .
```

Three things to do right after installing, before the first cycle:

- **`.pi/harness.config.json`** — replace the example values with the project's: `provider` plus the
  `model:` lines in `.pi/agents/*.md` must name your own provider, `gates` must be the commands this
  project actually runs. The templates ship the neutral `acme/` prefix and `acme/…` model names —
  placeholders to be replaced together, config and agents alike, not a recommendation of a provider.
  A provider in the config that does not match the `model:` prefix in the agents is a layout
  violation (H4) and is reported as such.
- **`AGENTS.md`** — the project's roles and prohibitions; the core reads the file, the project
  writes it.

### 2. `cycle-state init` — one cycle, three facts

The branch must already exist and be checked out: `--branch` is verified against git, because
commits and `gh pr create` would otherwise go somewhere else and the mismatch would surface only at
the PR stage. The cycle start is `main`; `--slug` is the tail of the branch name after the issue
number.

```bash
git switch -c feat/214-invoice-export
pnpm exec harness-cycle-state init \
  --issue 214 \
  --slug invoice-export \
  --branch feat/214-invoice-export
```

```json
{
  "applied_decision": null,
  "base_sha": "0ccea4cfd17a46a6660e9729d166fcd8f898b278",
  "branch": "feat/214-invoice-export",
  "criteria_sha256": null,
  "criteria_source": "issue",
  "escalation": null,
  "history": [
    {
      "finished_at": "2026-11-22T11:30:30.168Z",
      "iteration": 1,
      "stage": "INIT",
      "started_at": "2026-11-22T11:30:30.168Z",
      "status": "done"
    }
  ],
  "issue": 214,
  "iteration": 1,
  "max_iterations": 2,
  "models": { "code": "…", "evaluate": "…", "plan": "…", "review": "…" },
  "owner_approved": false,
  "retries": { "EVALUATE": 0, "REVIEW": 0, "evidence": 0 },
  "slug": "invoice-export",
  "stage": "INIT",
  "stage_status": "done",
  "started_at": "2026-11-22T11:30:30.168Z",
  "updated_at": "2026-11-22T11:30:30.168Z"
}
```

The output is one line; `models` is shortened to its keys here, the rest is what the command
printed. The artifact directory is `.pi/artifacts/2026-11-22-214-invoice-export`: the date, the
issue number and the slug read together with the branch `feat/214-invoice-export`.

### 3. `cycle-driver next` — what to do right now

The driver answers with a single step descriptor: the same JSON the Pi adapter reads. It does not
run models, does not commit and does not create the PR — it says who should do what and with which
input.

```bash
pnpm exec harness-cycle-driver next
```

```json
{
  "contract": "cycle-driver.next/1",
  "cycle": {
    "issue": 214,
    "branch": "feat/214-invoice-export",
    "dir": "/work/shop/.pi/artifacts/2026-11-22-214-invoice-export",
    "iteration": 1,
    "max_iterations": 2,
    "stage": "INIT",
    "stage_status": "done",
    "owner_approved": false,
    "escalation": null
  },
  "stage": "INIT",
  "status": "done",
  "action": "run",
  "reason": "criteria_missing",
  "step": "criteria",
  "target": null,
  "gate": null,
  "spawn": null,
  "allowed_next": ["PLAN"],
  "waiting_for": "evidence/criteria.md",
  "notes": [],
  "commands": [
    "node node_modules/@dnikulshin/harness/scripts/cycle-evidence.mjs criteria --dir … --issue-json …/issue.json"
  ],
  "done": {
    "stages": ["…"],
    "driver": { "steps": 1, "executed": 1, "handed_off": 0, "mismatch": 0 }
  }
}
```

The block is pretty-printed rather than byte-for-byte: `dir` and the paths in `commands` are
shortened, `stages` is a single `…`. Field values come from the same run.

`action` is the contract: `run` and `advance` are deterministic steps the driver or the adapter
executes, `spawn` and `handoff` are model work, `stop` and `blocked` mean a human is needed. Exit
codes: `0` — a step was determined or executed, `1` — `blocked`, `2` — a usage or data error,
`3`/`4` — state conflict and oversized diff, passed through from the subprocess.

The full sequence, artifact names and stage transitions are in
[docs/orchestrator-core.md](./docs/orchestrator-core.md) (§5.3a for the driver); the policy and the
human checkpoints are in [docs/orchestrator.md](./docs/orchestrator.md).

### 4. `cycle-gates` — no gates yet

The cycle is started, the config has no `gates` section. That is a valid state, not a broken config:
the cycle says so and exits with code 2 instead of pretending the checks passed.

```bash
pnpm exec harness-cycle-gates
```

```text
cycle-gates: гейты не заданы: добавьте секцию gates в .pi/harness.config.json (пример конфига ставит harness-init)
# exit code 2
```

The example config, by contrast, comes with `acme` gates (`pnpm --filter @acme/core build`,
`pnpm typecheck`, …): until they are replaced with the project's own, they fail — that is the reason
to replace them, not a sign the core is broken.

## Package commands (`bin`)

| Command                  | Script                       |
| ------------------------ | ---------------------------- |
| `harness-cycle-state`    | `scripts/cycle-state.mjs`    |
| `harness-cycle-driver`   | `scripts/cycle-driver.mjs`   |
| `harness-cycle-gates`    | `scripts/cycle-gates.mjs`    |
| `harness-cycle-evidence` | `scripts/cycle-evidence.mjs` |
| `harness-cycle-decide`   | `scripts/cycle-decide.mjs`   |
| `harness-cycle-metrics`  | `scripts/cycle-metrics.mjs`  |
| `harness-cycle-report`   | `scripts/cycle-report.mjs`   |
| `harness-cycle-pr-body`  | `scripts/cycle-pr-body.mjs`  |
| `harness-cycle-usage`    | `scripts/cycle-usage.mjs`    |
| `harness-check-layout`   | `scripts/check-harness.mjs`  |
| `harness`                | `scripts/harness.mjs`        |
| `harness-init`           | `scripts/harness-init.mjs`   |
| `harness-evals-collect`  | `scripts/evals-collect.mjs`  |
| `harness-evals-cost`     | `scripts/evals-cost.mjs`     |
| `harness-evals-pack`     | `scripts/evals-pack.mjs`     |
| `harness-evals-score`    | `scripts/evals-score.mjs`    |
| `harness-selftest`       | `scripts/selftest.mjs`       |

`harness` is a dispatcher for the first run: `harness init` (install templates) and `harness check`
(layout check). The other commands are called by their own names: the dispatcher does not duplicate
their logic, it runs the same script and returns its exit code.

`harness-check-layout` checks the layout of the project in the **current directory** (for the core —
its own root); `--root <dir>` addresses another tree, such as a test fixture.

`harness-selftest` runs the core's tests from the installed package. Checks that need the core
repository itself (the repository root, `evals/` seeds, the price snapshot) are skipped with a
reason in the package: the consumer does not receive that data and brings its own.

### Importing core modules

The scripts are both CLI and library: every `bin` entry has a same-named entry point without the
`bin` prefix, e.g. `harness-cycle-gates` → `@dnikulshin/harness/scripts/cycle-gates`. The surface is
declared in `exports` explicitly rather than by a `./scripts/*` template:

```js
import { runGates } from '@dnikulshin/harness/scripts/cycle-gates';
import { loadConfig } from '@dnikulshin/harness/scripts/lib/cycle/config';
```

`scripts/lib/cycle/config` is the only internal module left public: it is the seam for code that
reads the project config outside the CLI. Everything else under `scripts/lib/**`, tests and fixtures
are closed: importing such a path yields `ERR_PACKAGE_PATH_NOT_EXPORTED`. The rule is enforced by a
test over `package.json` (every `bin` must have an `exports` key) and by a test against the
installed package (`scripts/package-consumer.test.mjs`).

`scripts/**/*.test.mjs` and `scripts/fixtures/` end up in the archive on purpose: `harness-selftest`
runs them from `node_modules`. That is self-test data, not public API.

### Installing templates into a project (`harness init`)

Policy stays with the project: role and prompt templates come from the package and are adapted to
the project, the config is assembled from the example. No copy of the core appears — `scripts/`
stays empty of cycle code in the project.

```bash
pnpm harness-init            # install and check the layout
pnpm harness-init --check    # report only: what is stale, what was edited locally
pnpm harness-init --dry-run  # plan without writing
pnpm harness-init --force    # overwrite files that were edited by hand
```

Where files go is decided by the project's **layout profile** (`paths` in its config), not by
installer defaults: on a profile with `agentsDir: "harness/agents"` the roles land there. A config
outside `.pi/` is found by the same flag as every other command
(`--config harness/harness.config.json`), and if it does not exist yet it is created at that path.

| Taken from the package                              | Goes to the project                      |
| --------------------------------------------------- | ---------------------------------------- |
| `templates/.pi/agents/*.md`                         | `paths.agentsDir` (adapt to the project) |
| `templates/.pi/prompts/cycle.md`                    | `paths.cyclePrompt`                      |
| `templates/.pi/harness.config.example.json`         | the project config (`.pi/` by default)   |
| `docs/orchestrator-core.md`, `docs/orchestrator.md` | `docs/` (copied by hand)                 |

Besides templates the command creates a settings file (`paths.settings`, `.pi/settings.json` by
default) with `subagents.maxSubagentSpawnsPerRun` (H5) if the file is absent — an existing one is
not touched, but a violation is printed; and `harness.version` next to the config — the package
version plus the `sha256` of every installed file. It then checks the layout with the same code as
`check-harness` and prints what is left to adapt to the project (`AGENTS.md`, gates, models): a
fresh template project does not know them, and "left to adapt" is a hint, not an installation
failure.

Exit codes: `0` — the plan is done (including "already up to date"); `1` — there are differences the
command did not fix (local edits without `--force`, drift under `--check`); `2` — a usage or read
error.

**Template version and migrations.** `harness.version` remembers the digests of what was installed,
so a package update does not wipe the project's work: a file whose digest matches the recorded one
was not edited locally and can be updated; a mismatch means it was edited, and overwriting happens
only with `--force`. The project config is never updated after creation: it is policy, not a
template. Files that no longer exist in the templates are not deleted — the command reports them.

The ready-made files live in `node_modules/@dnikulshin/harness/`; the core does not import project
modules.

Upgrading the package and migrations — see
[«Template version and migrations»](#installing-templates-into-a-project-harness-init) above; what
counts as public API and how a breaking change is announced — [docs/release.md](./docs/release.md).

## Configuration `.pi/harness.config.json`

The file is optional: without it neutral defaults apply and the gate list is empty. An empty gate
list is a valid state: `cycle-gates` reports "no gates configured" and exits with code 2.

The config location is the only fixed point of the layout. By default it is
`<root>/.pi/harness.config.json`; another path is set with the `--config <file>` flag or the
`HARNESS_CONFIG` environment variable (the flag wins), identically for every package command. A
relative path is resolved from the project root. An explicitly given path that does not exist is an
error with code 2 rather than silent defaults: a typo must not look like "the settings were
applied".

Sections: `gates` (array of checks: `id`, `executable` + `args`, `required`, `dependsOn`,
`pathPrefixes`, `dbGate`, `env`), `limits`, `paths`, `evals`, `qaWeb`, `provider`, `gateTimeouts`.
Three settings matter for cycle behaviour:

- `qaWeb.pathPrefixes` — which paths make a diff web-affecting (a browser check is needed); an empty
  list means the project does not ask for QA_WEB;
- `gates[].dbGate: true` — the failure class of the gate is derived from the log: no database →
  `not_run` with reason `no_database` instead of `fail`. Bound to the flag, not to the name
  `test_int`;
- `gates[].env` — the gate's declared environment: `allow` + `set` instead of full inheritance (see
  "Gates are code you run"). Not declared — the gate inherits everything, as before.

```json
{
  "provider": "acme/",
  "gates": [
    {
      "id": "test",
      "executable": "pnpm",
      "args": ["test"],
      "required": true,
      "dependsOn": [],
      "pathPrefixes": []
    },
    {
      "id": "format_check",
      "executable": "pnpm",
      "args": ["format:check"],
      "required": true,
      "dependsOn": [],
      "pathPrefixes": []
    }
  ],
  "limits": {
    "maxDiffLines": 2000,
    "maxDiffBytes": 409600,
    "logMaxBytes": 5242880,
    "evidenceTailLines": 200,
    "defaultMaxIterations": 2,
    "maxCycleCostRub": 30
  },
  "paths": {
    "artifactsDir": ".pi/artifacts",
    "evidenceDir": "evidence",
    "gatesDir": "gates",
    "agentsDir": ".pi/agents",
    "agentsMd": "AGENTS.md",
    "settings": ".pi/settings.json",
    "cyclePrompt": ".pi/prompts/cycle.md",
    "prTemplate": ""
  },
  "evals": {
    "prices": "evals/prices.json",
    "profiles": "evals/profiles.json",
    "candidates": "evals/candidates.json",
    "seedsDir": "evals/orchestrator/seeds"
  },
  "qaWeb": {
    "pathPrefixes": ["apps/web/"]
  },
  "gateTimeouts": {
    "test": 600000,
    "format_check": 120000
  }
}
```

### Limits and where they come from

Each of the six limits is resolved by a single priority: **CLI flag → environment variable → project
config → core default**. Only two keys have flags (`--max-cost-rub` on `cycle-decide`,
`--max-iterations` on `cycle-state init`); the rest are overridden by
`HARNESS_LIMIT_<KEY_IN_SNAKE_UPPER>` — for example `HARNESS_LIMIT_MAX_DIFF_LINES=5000`.

An invalid value (not a number, not an integer where one is required, out of range) is an error with
code 2 rather than a silent fallback to the default: otherwise a raised threshold "does not apply"
without a trace. The applied values and their source are written to `decision.<n>.json` and
`metrics.json` (`applied_limits`), and the source of the budget threshold appears in the `budget: …`
reason. The full rule is in `docs/orchestrator-core.md`, §5.2.

Rules:

- `gates[]` — execution order; `executable` + `args` are run without a shell, arguments are not
  interpolated. The old `cmd` string format is still supported: it is split on whitespace and prints
  a warning.
- The built-in check `secrets_scan` is declared as
  `{ "id": "secrets_scan", "builtin": "secrets_scan" }`.
- `gateTimeouts` — milliseconds; keys must be declared in `gates`.
- Config errors: unknown section or field, wrong type, negative number, empty `id`, duplicate `id`,
  missing `executable` — code 2 with a clear message, never a silent default.
- Diagnostics never print the contents of `.env*`.

The full example with hint values is `templates/.pi/harness.config.example.json` (JSON has no
comments, so the explanations live in this README and in the example itself through neutral values
and mnemonic names).

## Commands

```bash
node --test             # all tests
pnpm typecheck          # tsc --noEmit: strict type check (strict + noUncheckedIndexedAccess)
pnpm typecheck:types    # regenerate `types/` — .d.ts for package consumers
pnpm format:check       # prettier --check .
pnpm format             # prettier --write .
pnpm check              # node --test && tsc --noEmit && prettier --check .
pnpm board:sync         # reconcile the Projects board with issues (docs/board.md)
pnpm board:sync:dry     # same, plan only: nothing is written to the project
```

The code stays `.mjs`: types come from JSDoc, checking from `tsc` (decision and cost —
[docs/adr/0002](./docs/adr/0002-strict-typing.md)). The `.d.ts` files for consumers are generated
from JSDoc and **committed** to `types/`; CI verifies they are current
(`pnpm typecheck:types:check`), so installing the package builds nothing and pulls no
devDependencies.

## Documentation

- **Documentation site:** <https://dnikulshin.ru/dev-harness/> — the same text as in `docs/`, as a
  site (GitHub Pages from `docs/`, built by `.github/workflows/pages.yml`).
- [docs/index.md](./docs/index.md) — map of the documentation: protocol, process, infrastructure,
  ADRs.
- [docs/protocol.md](./docs/protocol.md) — entry point to the protocol specification.
- [docs/vision.md](./docs/vision.md) — why the repository exists and what v0.1 delivers.
- [docs/adr/](./docs/adr/README.md) — accepted architecture decisions: layout profiles and artifact
  classes, strict typing, the boundary "environment infrastructure is not in the core".
- [docs/rag.md](./docs/rag.md) — the rule for working with the `local-rag` index: what to
  synchronize, how to search, what to do without RAG. A consumer copies the text, not the automation
  script.
- [docs/board.md](./docs/board.md) — the Projects board: column rules, `status:*` labels, the
  `pnpm board:sync` reconciliation and the `PROJECT_TOKEN` secret. Repository infrastructure, not
  part of the package.
- [docs/workflow.md](./docs/workflow.md) — development process: roles, branches, commits, PRs,
  releases, Definition of Done.
- [AGENTS.md](./AGENTS.md) — development rules of dev-harness itself.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — how to propose a change: issue, branch, commit, checks, PR.
- [SECURITY.md](./SECURITY.md) — how to report a vulnerability privately and what is not a
  vulnerability.
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — contributor code of conduct (Contributor Covenant
  2.1).
- [Wiki](https://github.com/DNikulshin/dev-harness/wiki) — onboarding for a new contributor:
  install, quick start, FAQ; normative texts stay in `docs/`.

## Gates are code you run

`.pi/harness.config.json` is executable code, not a declaration: `executable` + `args` are run
without a shell, with the permissions of the user who started the cycle. "The gate is trusted" means
exactly that: you agreed to run these commands. A license, a package signature and a sandbox add
nothing here. By default a gate inherits the whole process environment (`DATABASE_URL`, CI tokens,
provider keys) — otherwise the documented `test_int` and `turbo`/`pnpm` break. A gate can narrow
that surface with `env`:

```json
"env": { "allow": ["npm_config_cache"], "set": { "CI": "1" } }
```

Once `env` is declared, inheritance is off: only the listed variables, the literal `set` values and
the service variables `PATH`, `HOME`, `TMPDIR` remain (`TURBO_FORCE=true` is always set).

**What is protected and what is not.** A declared `env` keeps a gate away from a secret it was not
told about. Nothing goes beyond that: the gate can still read `.env`, `~/.npmrc` and project files,
reach the network and run anything as you. Do not expect isolation or "secure by default": this
narrows the surface, it is not a sandbox. Output masking (§5.4 of `docs/orchestrator-core.md`) is a
separate measure: a secret that reaches the log is hidden, which is not the same as not handing it
to the process.

**Practices for CI.**

- Keep secrets in a separate job (or a separate workflow), not in the one where gates run.
- For gates that need no secrets, declare `env` — a minimal `allow`, with no "just in case" names:
  an unused variable in `allow` gives a false sense of control. If there is nothing to declare, the
  honest declaration is `env: {}`, service variables only.
- A change to `.pi/harness.config.json` deserves explicit review: it edits executable code. If the
  config is listed in `integrity.protectedPaths`, the edit shows up in `evidence/integrity.json` and
  in the PR "Checks" section; that is visibility, not a prohibition — a human decides.

The full rule, service variables and strict schema validation are in §5.5 of
`docs/orchestrator-core.md`; the decision is in [ADR 0007](./docs/adr/0007-gate-env.md).

## License

MIT — see [LICENSE](./LICENSE). The same license covers the code, the scripts, the templates in
`templates/` and the documentation in `docs/`, including the transferred normative texts: the rights
holder is the same.

The license does not change operating rules: gates run the consumer project's commands, so trust in
`.pi/harness.config.json` stays with the consumer — see "Gates are code you run" above and §5.5 of
`docs/orchestrator-core.md`.
