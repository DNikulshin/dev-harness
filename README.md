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

Зависимость по git-тегу (после первого релиза):

```json
{
  "devDependencies": {
    "@dnikulshin/harness": "github:DNikulshin/dev-harness#v0.1.0"
  }
}
```

До релиза — по ветке или коммиту:

```bash
pnpm add -D github:DNikulshin/dev-harness#feat/1-core-from-hair-lab
```

Дальше проект переносит к себе нужные файлы (копированием или скриптом) и настраивает конфиг:

| Что переносится                                     | Куда в проекте                            |
| --------------------------------------------------- | ----------------------------------------- |
| `scripts/cycle-*.mjs`                               | `scripts/`                                |
| `scripts/check-harness.mjs`                         | `scripts/`                                |
| `scripts/evals-*.mjs`                               | `scripts/`                                |
| `scripts/lib/cycle/**`                              | `scripts/lib/cycle/`                      |
| `scripts/lib/evals/**`                              | `scripts/lib/evals/`                      |
| `templates/.pi/agents/*.md`                         | `.pi/agents/` (и адаптировать под проект) |
| `templates/.pi/prompts/cycle.md`                    | `.pi/prompts/cycle.md`                    |
| `templates/.pi/harness.config.example.json`         | `.pi/harness.config.json`                 |
| `docs/orchestrator-core.md`, `docs/orchestrator.md` | `docs/`                                   |

Ядро не импортирует проектные модули, поэтому переносить достаточно этих файлов.

## Конфигурация `.pi/harness.config.json`

Файл необязателен: без него работают нейтральные дефолты, а список гейтов пуст. Пустой список гейтов
— валидное состояние: `cycle-gates` сообщает «гейты не заданы» и выходит с кодом 2.

```json
{
  "provider": "acme-ai/",
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
  "gateTimeouts": {
    "test": 600000,
    "format_check": 120000
  }
}
```

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
node --test          # все тесты
pnpm format:check    # prettier --check .
pnpm format          # prettier --write .
pnpm check           # node --test && prettier --check .
```

## Документация

- [docs/protocol.md](./docs/protocol.md) — точка входа в норматив протокола.
- [docs/vision.md](./docs/vision.md) — зачем репозиторий и границы v0.1.
- [docs/extraction-from-harness.md](./docs/extraction-from-harness.md) — что и откуда перенесено
  (инвентаризация hair-lab, issue DNikulshin/hair-lab#233).
- [AGENTS.md](./AGENTS.md) — правила разработки самого dev-harness.
