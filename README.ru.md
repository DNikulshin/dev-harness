# @dnikulshin/harness

[![CI](https://github.com/DNikulshin/dev-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/DNikulshin/dev-harness/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dnikulshin/harness)](https://www.npmjs.com/package/@dnikulshin/harness)
[![Node](https://img.shields.io/badge/node-%3E%3D26.13%20%3C27-informational)](./.nvmrc)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-dnikulshin.ru%2Fdev--harness-informational)](https://dnikulshin.ru/dev-harness/)

[English version](./README.md) · **Русский**

Переиспользуемое ядро цикла разработки: детерминированные скрипты
`plan → code → gates → review → evaluate → decide`, схема артефактов, проверка раскладки harness и
evals-слой.

Ядро не знает конкретный проект. Гейты, лимиты, пути и провайдер моделей задаются в
`.pi/harness.config.json` проекта; роли и запреты — в `AGENTS.md` проекта.

**Статус:** v0.2.1, опубликован в npm. Что считается публичным API и как объявляется несовместимое
изменение — [docs/release.md](./docs/release.md).

## Требования

- **Node.js 26.13.x** — `engines.node` = `>=26.13 <27`, `.nvmrc` = `26.13.1`; CI идёт на этой
  версии.
- **Linux или macOS** — `os: ["linux", "darwin"]` в `package.json`, CI гоняет один и тот же набор
  шагов на `ubuntu-latest` и `macos-latest`. **Windows не поддерживается:** тайм-аут гейта завершает
  не только сам процесс, но и его потомков через группу процессов (`detached: true`
  - `process.kill(-pid)`, §5.5 `docs/orchestrator-core.md`), а на Windows группы процессов работают
    иначе — гейт без гарантии завершения потомков хуже явного отказа в установке.
- **git** (дифф от `base_sha`), **pnpm** для `pnpm`-команд проекта (версия — из `packageManager`) и
  **gh** CLI для команд доски и гигиены веток. Это требования команд, а не самого пакета: ядро зовёт
  только `git` и `node` и ничего не тянет из сети.

## Зачем

Один и тот же цикл нужен нескольким проектам. Копия ядра в каждом репозитории расходится и чинится
по нескольку раз. Отдельный репозиторий держит механизм общим, а политику оставляет проекту.
Подробнее — [docs/vision.md](./docs/vision.md).

## Подключение к проекту

Ядро подключается **как пакет**, а не копированием файлов: копия в проекте повторила бы ровно ту
проблему дублей, из-за которой ядро выносилось. Основной путь — реестр npm:

```bash
npx @dnikulshin/harness init      # шаблоны, конфиг из примера, проверка раскладки
pnpm add -D @dnikulshin/harness   # дальше — команды пакета из devDependencies
```

`npx` работает без установки: пакет скачивается на время запуска, проект не меняется, кроме
созданных файлов. Дальше команды вызываются через `pnpm exec harness-init`,
`pnpm exec harness-cycle-gates` и т.д. (`bin` перечислены ниже).

Для пилота остаётся git-ссылка — тот же код без реестра, по тегу:

```json
{
  "devDependencies": {
    "@dnikulshin/harness": "github:DNikulshin/dev-harness#v0.2.1"
  }
}
```

Репозиторий публичный: токен для установки не нужен ни из реестра, ни по git-ссылке.

### 1. `harness init` — шаблоны и конфиг

Запускается в корне проекта, при уже существующем `AGENTS.md` (без него команда ставит шаблоны, но
пропускает проверку раскладки и говорит об этом):

Проект с `AGENTS.md`:

```text
создан: .pi/agents/code.md
создан: .pi/agents/evaluate.md
создан: .pi/agents/plan.md
создан: .pi/agents/review.md
создан: .pi/harness.config.json
создан: .pi/prompts/cycle.md
создан: .pi/settings.json (subagents.maxSubagentSpawnsPerRun = 7)
записан: .pi/harness.version (версия 0.2.1)
W2: .pi/agents/evaluate.md — семейство модели совпадает с plan: z-ai (принятый риск I3, ребро не проверяется, действий не требуется; docs/orchestrator.md §18)
проверка раскладки: нарушений нет, предупреждений 1 (информационные — действий не требуется)
проверить отдельно: harness-check-layout --root .
```

Проект без `AGENTS.md` — проверка раскладки пропускается, и команда говорит, почему:

```text
проверка раскладки не выполнена: нет AGENTS.md — создайте его
проверить отдельно: harness-check-layout --root .
```

Сразу после установки — три вещи, до первого цикла:

- **`.pi/harness.config.json`** — заменить примерные значения на проектные: `provider` и строки
  `model:` в `.pi/agents/*.md` должны называть вашего провайдера, `gates` — команды, которые проект
  действительно гоняет. Шаблоны приходят с примерным префиксом провайдера и моделями ядра — ровно
  для того, чтобы их заменили, а не унаследовали. Провайдер в конфиге, не совпадающий с префиксом
  `model:` у агентов, — нарушение раскладки (H4), и оно так и печатается;
- **`AGENTS.md`** — роли и запреты проекта; ядро его читает, проект пишет.

### 2. `cycle-state init` — один цикл и три факта

Ветка должна уже существовать и быть текущей: `--branch` сверяется с git, иначе коммиты и
`gh pr create` ушли бы не туда, а рассинхрон всплыл бы только на PR-стадии. Начало цикла — `main`;
`--slug` — хвост имени ветки после номера issue.

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

Вывод — одна строка; здесь `models` сокращён до ключей, остальное — как напечатала команда. Каталог
артефактов — `.pi/artifacts/2026-11-22-214-invoice-export`; дата, номер и slug читаются вместе с
веткой.

### 3. `cycle-driver next` — что делать прямо сейчас

Драйвер отвечает одним дескриптором шага — тем же JSON, что читает адаптер Pi. Модели он не
запускает, не коммитит и PR не создаёт: он говорит, кому и с каким входом идти дальше.

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

Блок — prettier-формат, а не байт-в-байт вывод: `dir` и пути в `commands` сокращены, `stages`
перечислены одной строкой. Значения полей — из того же прогона.

`action` — и есть контракт: `run` и `advance` — детерминированные шаги, их исполняет драйвер или
адаптер; `spawn` и `handoff` — работа моделей; `stop` и `blocked` — нужен человек. Коды выхода: `0`
— шаг определён или исполнен, `1` — `blocked`, `2` — ошибка использования или данных, `3`/`4` —
конфликт состояния и слишком большой дифф, как их отдал подпроцесс.

Полная последовательность, имена артефактов и переходы стадий —
[docs/orchestrator-core.md](./docs/orchestrator-core.md) (§5.3a — драйвер); политика и точки
подтверждения человеком — [docs/orchestrator.md](./docs/orchestrator.md).

### 4. `cycle-gates` — гейтов ещё нет

Цикл начат, секции `gates` в конфиге нет. Это валидное состояние, а не поломка: цикл говорит об этом
словами и выходит с кодом 2 вместо ложного «проверки прошли».

```bash
pnpm exec harness-cycle-gates
```

```text
cycle-gates: гейты не заданы: добавьте секцию gates в .pi/harness.config.json (пример конфига ставит harness-init)
# код выхода 2
```

Пример конфига, наоборот, приходит с гейтами `acme` (`pnpm --filter @acme/core build`,
`pnpm typecheck`, …): пока это чужие команды, они падают — это и есть повод их заменить, а не
признак, что ядро не работает.

### Команды пакета (`bin`)

| Команда                  | Скрипт                       |
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

`harness` — диспетчер для первого запуска: `harness init` (установка шаблонов) и `harness check`
(проверка раскладки). Остальные команды вызываются своими именами: диспетчер не повторяет их логику,
а запускает тот же скрипт и возвращает его код выхода.

`harness-check-layout` проверяет раскладку проекта в **текущем каталоге** (у ядра — его корень);
`--root <dir>` адресует другое дерево, например фикстуру в тестах.

`harness-selftest` прогоняет тесты ядра из установленного пакета. Проверки, которым нужен сам
репозиторий ядра (корень репозитория, сиды `evals/`, снапшот цен), в пакете пропускаются с причиной:
этих данных потребитель не получает и приносит свои.

### Импорт модулей ядра

Скрипты одновременно CLI и библиотеки: у каждого `bin` есть одноимённая точка входа без
`bin`-префикса, например `harness-cycle-gates` → `@dnikulshin/harness/scripts/cycle-gates`.
Поверхность объявлена в `exports` явно, а не шаблоном `./scripts/*`:

```js
import { runGates } from '@dnikulshin/harness/scripts/cycle-gates';
import { loadConfig } from '@dnikulshin/harness/scripts/lib/cycle/config';
```

`scripts/lib/cycle/config` — единственный внутренний модуль, оставленный публичным: это шов для тех,
кто читает конфиг проекта из своего кода, а не через CLI. Всё остальное внутри `scripts/lib/**`,
тесты и фикстуры закрыты: импорт такого пути даёт `ERR_PACKAGE_PATH_NOT_EXPORTED`. Правило
проверяется тестом по `package.json` (каждый `bin` обязан иметь ключ `exports`) и тестом на
установленном пакете (`scripts/package-consumer.test.mjs`).

`scripts/**/*.test.mjs` и `scripts/fixtures/` в архив попадают намеренно: их прогоняет
`harness-selftest` из `node_modules`. Это данные самотеста, а не публичное API.

### Установка шаблонов в проект (`harness init`)

Политика остаётся проектной: шаблоны ролей и промпта ставятся из пакета и адаптируются под проект,
конфиг собирается из примера. Копия ядра при этом не появляется — `scripts/` в проекте пуст по
отношению к циклу.

```bash
pnpm harness-init            # установить и проверить раскладку
pnpm harness-init --check    # только отчёт: что устарело, что правили локально
pnpm harness-init --dry-run  # план без записи
pnpm harness-init --force    # перезаписать файлы, которые правили руками
```

Куда ставить — решает **профиль раскладки** проекта (`paths` в его конфиге), а не умолчания
установщика: на профиле с `agentsDir: "harness/agents"` роли едут туда. Конфиг вне `.pi/` находится
тем же флагом, что у остальных команд (`--config harness/harness.config.json`), и если его ещё нет —
создаётся по этому пути.

| Что берётся из пакета                               | Куда в проекте                                |
| --------------------------------------------------- | --------------------------------------------- |
| `templates/.pi/agents/*.md`                         | `paths.agentsDir` (и адаптировать под проект) |
| `templates/.pi/prompts/cycle.md`                    | `paths.cyclePrompt`                           |
| `templates/.pi/harness.config.example.json`         | конфиг проекта (по умолчанию `.pi/`)          |
| `docs/orchestrator-core.md`, `docs/orchestrator.md` | `docs/` (копируются вручную)                  |

Кроме шаблонов команда создаёт файл настроек (`paths.settings`, по умолчанию `.pi/settings.json`) с
`subagents.maxSubagentSpawnsPerRun` (H5), если файла нет, — существующий не меняется, но нарушение
печатается; и `harness.version` рядом с конфигом — версию пакета с `sha256` каждого установленного
файла. Дальше она сверяет раскладку тем же кодом, что `check-harness`, и печатает, что осталось
поправить под проект (`AGENTS.md`, гейты, модели): свежий шаблон проекта не знает, и «осталось
поправить» — подсказка, а не провал установки.

Коды выхода: `0` — план выполнен (в том числе «уже актуально»); `1` — есть расхождения, которые
команда не правила (локальные правки без `--force`, дрейф в `--check`); `2` — ошибка использования
или чтения.

**Версия шаблонов и миграции.** `harness.version` помнит дайджесты того, что поставили, поэтому
обновление пакета не затирает работу проекта: файл, чей дайджест совпал с записанным, локально не
правили — его можно обновить; не совпал — правили, и перезапись только по `--force`. Конфиг проекта
после создания не обновляется никогда: это политика, а не шаблон. Файлы, которых больше нет в
шаблонах, не удаляются — команда о них сообщает.

Готовые файлы лежат в `node_modules/@dnikulshin/harness/`; ядро не импортирует проектные модули.

Обновление пакета и миграции — по разделу
[«Версия шаблонов и миграции»](#установка-шаблонов-в-проект-harness-init); что считается публичным
API и как объявляется несовместимое изменение — [docs/release.md](./docs/release.md).

## Конфигурация `.pi/harness.config.json`

Файл необязателен: без него работают нейтральные дефолты, а список гейтов пуст. Пустой список гейтов
— валидное состояние: `cycle-gates` сообщает «гейты не заданы» и выходит с кодом 2.

Место конфига — единственная фиксированная точка раскладки. По умолчанию это
`<корень>/.pi/harness.config.json`; другой путь задаётся флагом `--config <file>` или переменной
окружения `HARNESS_CONFIG` (флаг важнее), одинаково для всех команд пакета. Относительный путь
считается от корня проекта. Явно заданный путь, которого нет, — ошибка с кодом 2, а не молчаливые
дефолты: опечатка не должна выглядеть как «настройки применились».

Секции: `gates` (массив проверок: `id`, `executable` + `args`, `required`, `dependsOn`,
`pathPrefixes`, `dbGate`, `env`), `limits`, `paths`, `evals`, `qaWeb`, `provider`, `gateTimeouts`.
Три настройки важны для поведения цикла:

- `qaWeb.pathPrefixes` — по каким путям дифф считается затрагивающим web (нужна браузерная
  проверка); пустой список — проект не просит QA_WEB;
- `gates[].dbGate: true` — у гейта класс отказа определяется по логу: нет базы → `not_run` с
  причиной `no_database` вместо `fail`. Привязано к флагу, а не к имени `test_int`;
- `gates[].env` — объявленное окружение гейта: `allow` + `set` вместо полного наследования (раздел
  «Гейты — это код, который вы запускаете»). Не объявлено — гейт наследует всё, как раньше.

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

### Лимиты и их источники

Каждый из шести лимитов разрешается по одному приоритету: **CLI-флаг → переменная окружения → конфиг
проекта → дефолт ядра**. Флаги есть только у двух ключей (`--max-cost-rub` у `cycle-decide`,
`--max-iterations` у `cycle-state init`), остальные переопределяются окружением
`HARNESS_LIMIT_<КЛЮЧ_В_SNAKE_UPPER>` — например `HARNESS_LIMIT_MAX_DIFF_LINES=5000`.

Невалидное значение (не число, не целое где нужно, вне диапазона) — ошибка с кодом 2, а не
молчаливый откат к дефолту: иначе поднятый порог «не применяется» без следа. Применённые значения и
их источник пишутся в `decision.<n>.json` и `metrics.json` (`applied_limits`), а источник порога
бюджета — в причине `budget: …`. Правило целиком — `docs/orchestrator-core.md`, §5.2.

Правила:

- `gates[]` — порядок выполнения; `executable` + `args` запускаются без оболочки, аргументы не
  интерполируются. Старый формат `cmd` строкой поддерживается: разбирается по пробелам и печатает
  предупреждение.
- Встроенная проверка `secrets_scan` задаётся как
  `{ "id": "secrets_scan", "builtin": "secrets_scan" }`.
- `gateTimeouts` — миллисекунды; ключи обязаны быть объявлены в `gates`.
- Ошибки конфига: неизвестная секция/поле, неверный тип, отрицательное число, пустой `id`, дубли
  `id`, отсутствующий `executable` — код 2 с понятным текстом, без молчаливого дефолта.
- Диагностика не печатает содержимое `.env*`.

Полный пример с комментариями-подсказками — `templates/.pi/harness.config.example.json` (JSON не
поддерживает комментарии, поэтому пояснения — в README и в самом примере через нейтральные значения
и мнемонические имена).

## Команды

```bash
node --test             # все тесты
pnpm typecheck          # tsc --noEmit: строгая проверка типов (strict + noUncheckedIndexedAccess)
pnpm typecheck:types    # пересобрать `types/` — .d.ts для потребителя пакета
pnpm format:check       # prettier --check .
pnpm format             # prettier --write .
pnpm check              # node --test && tsc --noEmit && prettier --check .
pnpm board:sync         # сверить доску Projects с issues (docs/board.md)
pnpm board:sync:dry     # то же, но только план: в проект ничего не пишется
```

Код остаётся `.mjs`: источник типов — JSDoc, проверка — `tsc` (решение и цена —
[docs/adr/0002](./docs/adr/0002-strict-typing.md)). `.d.ts` для потребителя генерируются из JSDoc и
**коммитятся** в `types/`; CI сверяет их актуальность (`pnpm typecheck:types:check`), поэтому
установка пакета ничего не собирает и не тянет devDependencies.

## Документация

- **Сайт документации:** <https://dnikulshin.ru/dev-harness/> — тот же текст, что в `docs/`, в виде
  сайта (GitHub Pages из `docs/`, сборка — `.github/workflows/pages.yml`).
- [docs/index.md](./docs/index.md) — карта документации: норматив, процесс, инфраструктура, ADR.
- [docs/protocol.md](./docs/protocol.md) — точка входа в норматив протокола.
- [docs/vision.md](./docs/vision.md) — зачем репозиторий и границы v0.1.
- [docs/adr/](./docs/adr/README.md) — принятые архитектурные решения: профили и классы артефактов,
  строгая типизация, граница «инфраструктура среды не в ядре».
- [docs/rag.md](./docs/rag.md) — правило работы с индексом `local-rag`: что синхронизировать, как
  искать и что делать без RAG. Потребитель берёт себе этот текст, а не скрипт автоматизации.
- [docs/board.md](./docs/board.md) — доска Projects: правила колонок, метки `status:*`, сверка
  `pnpm board:sync` и секрет `PROJECT_TOKEN`. Инфраструктура репозитория, в пакет не входит.
- [docs/workflow.md](./docs/workflow.md) — процесс разработки: роли, ветки, коммиты, PR, релизы,
  Definition of Done.
- [AGENTS.md](./AGENTS.md) — правила разработки самого dev-harness.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — как предложить изменение: issue, ветка, коммит, проверки,
  PR.
- [SECURITY.md](./SECURITY.md) — как приватно сообщить об уязвимости и что уязвимостью не считается.
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — кодекс поведения участников (Contributor Covenant
  2.1).
- [Вики](https://github.com/DNikulshin/dev-harness/wiki) — вход для нового участника: установка,
  быстрый старт, FAQ; нормативные тексты остаются в `docs/`.

## Гейты — это код, который вы запускаете

`.pi/harness.config.json` — исполняемый код, а не декларация: `executable` + `args` запускаются без
оболочки с правами пользователя, который запустил цикл. «Гейт доверенный» означает ровно это: вы
согласились запускать эти команды. Лицензия, подпись пакета и песочница тут ничего не добавляют. По
умолчанию гейт наследует всё окружение процесса (`DATABASE_URL`, токены CI, ключи провайдеров) —
иначе документированный `test_int` и `turbo`/`pnpm` ломаются. Гейт может сузить это поле `env`:

```json
"env": { "allow": ["npm_config_cache"], "set": { "CI": "1" } }
```

Объявил `env` — наследование выключается: остаются только перечисленные переменные, литеральные
`set` и служебные `PATH`, `HOME`, `TMPDIR` (`TURBO_FORCE=true` ставится всегда).

**Что защищено, а что нет.** Объявленный `env` не даёт гейту дойти до секрета, который ему не
назван. Дальше этого объявление не идёт: гейт по-прежнему может прочитать `.env`, `~/.npmrc` и файлы
проекта, сходить в сеть и запустить что угодно от вашего имени. Изоляции и «безопасности по
умолчанию» ждать неоткуда: это сужение поверхности, а не песочница. Маскирование вывода (§5.4
`docs/orchestrator-core.md`) — отдельная мера: секрет, попавший в лог, скрывается, но это не то же
самое, что не отдать его процессу.

**Практика для CI.**

- Секреты держите в отдельном job (или отдельном workflow), а не в том, где гоняются гейты.
- Гейтам, которым секреты не нужны, объявляйте `env` — минимальный `allow`, без имён «на всякий
  случай»: неиспользуемая переменная в `allow` даёт ложное «всё под контролем». Если объявлять
  нечего, честное объявление — `env: {}`, только служебные переменные.
- Изменение `.pi/harness.config.json` — повод для явного ревью: это правка исполняемого кода. Если
  конфиг перечислен в `integrity.protectedPaths`, правка попадает в `evidence/integrity.json` и
  печатается в «Проверках» PR; это видимость, а не запрет — решает человек.

Полное правило, служебные переменные и строгая валидация схемы — §5.5 `docs/orchestrator-core.md`,
решение — [ADR 0007](./docs/adr/0007-gate-env.md).

## Лицензия

MIT — см. [LICENSE](./LICENSE). Под одной лицензией идут код, скрипты, шаблоны в `templates/` и
документация в `docs/`, включая перенесённые нормативные тексты: правообладатель у них тот же.

Лицензия не отменяет правил эксплуатации: гейты запускают команды проекта-потребителя, поэтому
доверие к `.pi/harness.config.json` остаётся на стороне потребителя — см. «Гейты — это код, который
вы запускаете» выше и §5.5 `docs/orchestrator-core.md`.
