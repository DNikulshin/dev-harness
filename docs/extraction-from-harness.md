# Вынос ядра цикла из hair-lab

## Источник

Ядро перенесено из проекта `hair-lab` по инвентаризации hair-lab, issue
[DNikulshin/hair-lab#233](https://github.com/DNikulshin/hair-lab/issues/233). Inventory фиксирует 53
файла (31 модуль и 22 теста), их импорты, вызывающих, ввод-вывод и привязку к проекту; категории
распределены как `core`, `project-config`, `pi-adapter`, `evals`, `stays`.

Перенос — зеркальный: файлы скопированы без изменения логики, затем нейтрализованы проектные
значения и зашитые гейты заменены конфигом.

## Категории

| Категория        | Что это                                                                  | Куда в dev-harness                                         |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `core`           | скрипты цикла, модули `lib/cycle/*`, `lib/evals/cost.mjs`, фикстуры      | `scripts/`, `scripts/lib/`, `scripts/fixtures/`            |
| `project-config` | гейты, лимиты, тайм-ауты, роли агентов                                   | `.pi/harness.config.json`, шаблоны, загрузчик `config.mjs` |
| `pi-adapter`     | `check-harness`, `cycle-usage`, `lib/evals/{agents,usage}`, промпт цикла | `scripts/`, `templates/.pi/`                               |
| `evals`          | `evals-*.mjs`, `lib/evals/{score,seeds}`, сиды, цены, профили            | `scripts/`, `evals/`                                       |
| `stays`          | deploy, arch-check, precommit, rag-sync, lint-workflows, gh-*            | остались в hair-lab                                        |

## Что перенесено

- `scripts/cycle-*.mjs` и их тесты: `gates`, `decide`, `state`, `evidence`, `metrics`, `report`,
  `pr-body`, `usage`.
- `scripts/check-harness.mjs` (+ тест) и `scripts/evals-*.mjs` (+ тесты).
- `scripts/lib/cycle/*` (io, paths, git, refs, redact, validate, cost, config) и
  `scripts/lib/evals/*`.
- `scripts/fixtures/cycle/**`, `scripts/fixtures/harness/**`.
- `evals/prices.json`, `evals/profiles.json`, `evals/candidates.json`,
  `evals/orchestrator/seeds/**`.
- Роли `.pi/agents/{plan,code,review,evaluate}.md` и промпт `.pi/prompts/cycle.md` как шаблоны.
- Норматив `docs/orchestrator-core.md` и `docs/orchestrator.md`.

## Что осталось в hair-lab

- `deploy/**`, docker-compose, nginx-обвязка.
- `scripts/check-arch.mjs`, `scripts/precommit.mjs`, `scripts/rag-sync.mjs`,
  `scripts/lint-workflows.mjs`, `scripts/gh-*.mjs`.
- `.github/workflows/ci.yml` проекта и его секреты.
- Проектные `AGENTS.md`, `docs/qa-web.md`, `docs/evals.md`, `.pi/skills/*`.
- Workspace-пакеты приложения: UI, API, контракты, БД и миграции.

## Инфраструктура среды: копия, а не перенос

`scripts/rag-sync.mjs` в inventory hair-lab отнесён к категории `stays` — он остался в проекте,
потому что описывает среду, а не механизм цикла. В dev-harness такая же копия появилась осознанно:
`tooling/rag-sync.mjs` (ADR [0003](./adr/0003-environment-infrastructure.md)).

Почему копия, а не поставка пакетом: скрипт знает версию MCP-сервера, путь к общей базе LanceDB, кэш
и `BASE_DIRS` машины. Попади он в пакет — у потребителя он молча писал бы не в ту базу, а поломка
индексации выглядела бы как дефект ядра. Потребителю поставляется правило ([docs/rag.md](./rag.md)),
а не скрипт.

Категория файла изменилась, а не список перенесённого: `rag-sync` остаётся инфраструктурой, просто
теперь у двух репозиториев она своя. Настоящий перенос (в ядро) запрещён ADR 0003.

## Что изменено при переносе

1. Зашитые гейты hair-lab удалены из `config.mjs`; гейты приходят из `.pi/harness.config.json`
   (`executable` + `args`, без оболочки).
2. Появился загрузчик `loadConfig(root)` с дефолтами и строгой валидацией.
3. Проектные строки нейтрализованы: `acme`, `@acme/*`, `apps/service`, `apps/frontend`, `acme-ai/`,
   вымышленные данные в фикстурах. В коде ядра, фикстурах и примере конфига они остаются
   нейтральными; исключение — поставляемые `templates/.pi/agents/*.md` и собственный `.pi/` этого
   репозитория: там стоит реальный префикс провайдера, иначе скопированные шаблоны не проходят H4.
4. `check-harness` берёт пути и префикс провайдера из конфига.
5. Evals-скрипты читают пути снапшотов и сидов из конфига.

## Ссылки

- Issue выноса: DNikulshin/dev-harness#1.
- Инвентаризация: DNikulshin/hair-lab#233.
