# @dnikulshin/harness

Переиспользуемое ядро цикла разработки: детерминированные скрипты
`plan → code → gates → review → evaluate → decide`, схема артефактов, проверка раскладки harness и
evals-слой.

Ядро не знает конкретный проект. Гейты, лимиты, пути и провайдер моделей задаются в
`.pi/harness.config.json` проекта; роли и запреты — в `AGENTS.md` проекта.

**Статус:** v0.1 в разработке. API и формат конфига могут меняться до первого тега.

## Зачем

Один и тот же цикл нужен нескольким проектам. Копия ядра в каждом репозитории расходится и чинится
по нескольку раз. Отдельный репозиторий держит механизм общим, а политику оставляет проекту.
Подробнее — [docs/vision.md](./docs/vision.md).

## Подключение к проекту

Ядро подключается **как пакет**, а не копированием файлов: копия в проекте повторила бы ровно ту
проблему дублей, из-за которой ядро выносилось. Зависимость по git-тегу:

```json
{
  "devDependencies": {
    "@dnikulshin/harness": "github:DNikulshin/dev-harness#v0.1.0"
  }
}
```

До первого релиза — по ветке или коммиту:

```bash
pnpm add -D github:DNikulshin/dev-harness#main
```

Репозиторий публичный: токен для установки не нужен, `pnpm add` читает его анонимно. `private: true`
в пакете означает «не публикуется в npm», а не «нет доступа»: установка идёт только по git-ссылке, и
это не мешает `pnpm add`/`npm i` и `pnpm pack`.

Если репозиторий снова закроют, потребителю понадобится PAT на чтение (`HARNESS_READ_TOKEN` в
`devDependencies` через `//npm.pkg.github.com/` не подойдёт — это git-зависимость): приватный
git-URL потребует настроенного доступа `git`/`gh` на машине сборки и в CI.

### Команды пакета (`bin`)

| Команда                                             | Скрипт                       |
| --------------------------------------------------- | ---------------------------- |
| `harness-cycle-state`                               | `scripts/cycle-state.mjs`    |
| `harness-cycle-gates`                               | `scripts/cycle-gates.mjs`    |
| `harness-cycle-evidence`                            | `scripts/cycle-evidence.mjs` |
| `harness-cycle-decide`                              | `scripts/cycle-decide.mjs`   |
| `harness-cycle-metrics`                             | `scripts/cycle-metrics.mjs`  |
| `harness-cycle-report`                              | `scripts/cycle-report.mjs`   |
| `harness-cycle-pr-body`                             | `scripts/cycle-pr-body.mjs`  |
| `harness-cycle-usage`                               | `scripts/cycle-usage.mjs`    |
| `harness-check-layout`                              | `scripts/check-harness.mjs`  |
| `harness-evals-collect`, `-cost`, `-pack`, `-score` | `scripts/evals-*.mjs`        |
| `harness-selftest`                                  | `scripts/selftest.mjs`       |

`harness-selftest` прогоняет тесты ядра из установленного пакета. Проверки, которым нужен сам
репозиторий ядра (корень репозитория, сиды `evals/`, снапшот цен), в пакете пропускаются с причиной:
этих данных потребитель не получает и приносит свои.

### Импорт модулей ядра

Скрипты одновременно CLI и библиотеки, поэтому из проекта доступны прямые импорты:

```js
import { runGates } from '@dnikulshin/harness/scripts/cycle-gates';
import { loadConfig } from '@dnikulshin/harness/scripts/lib/cycle/config';
```

### Что проект приносит себе сам

Политика остаётся проектной: шаблоны ролей и промпта копируются из пакета и адаптируются под проект,
конфиг собирается из примера. Копия ядра при этом не появляется — `scripts/` в проекте пуст по
отношению к циклу.

| Что берётся из пакета                               | Куда в проекте                            |
| --------------------------------------------------- | ----------------------------------------- |
| `templates/.pi/agents/*.md`                         | `.pi/agents/` (и адаптировать под проект) |
| `templates/.pi/prompts/cycle.md`                    | `.pi/prompts/cycle.md`                    |
| `templates/.pi/harness.config.example.json`         | `.pi/harness.config.json`                 |
| `docs/orchestrator-core.md`, `docs/orchestrator.md` | `docs/`                                   |

Готовые файлы лежат в `node_modules/@dnikulshin/harness/`; ядро не импортирует проектные модули.

## Конфигурация `.pi/harness.config.json`

Файл необязателен: без него работают нейтральные дефолты, а список гейтов пуст. Пустой список гейтов
— валидное состояние: `cycle-gates` сообщает «гейты не заданы» и выходит с кодом 2.

Секции: `gates` (массив проверок: `id`, `executable` + `args`, `required`, `dependsOn`,
`pathPrefixes`, `dbGate`), `limits`, `paths`, `evals`, `qaWeb`, `provider`, `gateTimeouts`. Две
настройки важны для поведения цикла:

- `qaWeb.pathPrefixes` — по каким путям дифф считается затрагивающим web (нужна браузерная
  проверка); пустой список — проект не просит QA_WEB;
- `gates[].dbGate: true` — у гейта класс отказа определяется по логу: нет базы → `not_run` с
  причиной `no_database` вместо `fail`. Привязано к флагу, а не к имени `test_int`.

```json
{
  "provider": "polza-ai/",
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
