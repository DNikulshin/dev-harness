# Документация ядра

`@dnikulshin/harness` — детерминированный протокол
`plan → code → gates → review → evaluate → decide` для кодирующих агентов: скрипты, схема
артефактов, проверка раскладки harness и evals-слой.

Ядро не знает конкретный проект: гейты, лимиты, пути и провайдер моделей задаёт проект в
`.pi/harness.config.json`, роли — в его `AGENTS.md`.

## Быстрый старт

Ниже — команды и **реальный вывод** каждой из них, снятый на новом проекте (ядро 0.3.0). Вывод
сообщений ядра — на русском. Где вывод зависит от состояния проекта, состояние названо: иначе снимок
— утверждение про чужой проект, а не про ваш.

### 1. Шаблоны `.pi/` и ядро в devDependencies проекта

```bash
npx @dnikulshin/harness init
pnpm add -D @dnikulshin/harness
```

Проект с `AGENTS.md`:

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

Проект без `AGENTS.md` — проверка раскладки пропускается, и команда говорит, почему:

```text
проверка раскладки не выполнена: нет AGENTS.md — создайте его
проверить отдельно: harness-check-layout --root .
```

`W2` — предупреждение, а не отказ: установка считает его информационным и говорит об этом в итоговой
строке. Перед первым циклом замените примерные значения на проектные — `provider` в конфиге и
`model:` в `.pi/agents/*.md` должны называть **вашего** провайдера, `gates` — команды, которые
проект действительно гоняет.

Шаблоны, которые ставит `harness-init`, нейтральны: в примере конфига `"provider": "acme/"`, у
агентов — `acme/…`-модели с тремя сегментами (`<провайдер>/<семейство>/<модель>`). Это пара
заглушек, согласованная между собой: H4 проходит на свежей установке, а предупреждение `W2` (у
`plan` и `evaluate` одно семейство — принятый риск I3) видно сразу и не маскирует недонастройку.
Заменять надо обе половины сразу: префикс в конфиге и `model:` у всех четырёх агентов — иначе H4 и
есть та проверка, которая об этом скажет. Модель провайдера в шаблонах не выбирается намеренно:
решение о моделях — проекта, а не ядра (#204).

### 2. Ветка задачи: `<type>/<issue>-<slug>`

По ней же считается `base_sha`, а хвост после номера (схема `^[a-z0-9-]{1,60}$`) — тот самый
`--slug`:

```bash
git switch -c feat/214-invoice-export
```

### 3. Цикл: issue, slug и ветка — три факта об одной задаче

```bash
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
артефактов — `.pi/artifacts/2026-11-22-214-invoice-export`: дата, номер и slug читаются вместе с
веткой `feat/214-invoice-export`.

### 4. Что делать прямо сейчас

JSON шага — тот же, что читает адаптер Pi; модели драйвер не запускает, он говорит, кому идти
дальше:

```json
{
  "contract": "cycle-driver.next/1",
  "cycle": { "issue": 214, "branch": "feat/214-invoice-export", "iteration": 1, "stage": "INIT" },
  "stage": "INIT",
  "status": "done",
  "action": "run",
  "reason": "criteria_missing",
  "step": "criteria",
  "allowed_next": ["PLAN"],
  "waiting_for": "evidence/criteria.md",
  "commands": ["node …/cycle-evidence.mjs criteria --dir … --issue-json …/issue.json"]
}
```

Блоки показаны сокращённо: в `cycle` остались не все поля (`owner_approved`, `escalation`,
`max_iterations`, `dir` — в полном ответе), в `commands` — один путь из двух, а `notes` и `done`
опущены. Формат — prettier, а не байт-в-байт вывод; значения полей — из того же прогона.

`action` — контракт: `run`/`advance` — детерминированные шаги, `spawn`/`handoff` — работа моделей,
`stop`/`blocked` — нужен человек.

### 5. `cycle-gates` — гейтов ещё нет

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

Что важно знать до запуска:

- **`--branch` должен существовать и быть текущим**: `cycle-state init` сверяет имя с git и
  отказывает, если ветки нет;
- **`AGENTS.md` в проекте нужен заранее**: без него `harness init` ставит шаблоны, но пропускает
  проверку раскладки (`harness-check-layout`, H1–H6) и говорит об этом в выводе;
- цикл стартует от `main`: `base_sha` берётся от ветки `main`, и если её нет — `cycle-state init`
  говорит об этом словами, а не выводом git.

Требования: Node.js 26.13 или новее, Linux или macOS. Подробно —
[README репозитория](https://github.com/DNikulshin/dev-harness#readme) (есть
[английская версия](https://github.com/DNikulshin/dev-harness/blob/main/README.md)).

## Норматив

Сайт — удобное представление того же текста, что лежит в репозитории. Источник правды — файлы в
[`docs/`](https://github.com/DNikulshin/dev-harness/tree/main/docs); расхождение считается дефектом
сайта.

- [protocol.md](./protocol.md) — точка входа в норматив протокола.
- [orchestrator-core.md](./orchestrator-core.md) — реализация ядра: форматы артефактов (Приложения
  A–D), протокол супервизора, задачи `T*`.
- [orchestrator.md](./orchestrator.md) — политика и требования к поведению.
- [workflow.md](./workflow.md) — процесс разработки: роли, ветки, коммиты, PR, релизы, Definition of
  Done.
- [release.md](./release.md) — публичный API и правила версий.
- [board.md](./board.md) — доска Projects: колонки, метки `status:*`, сверка.
- [rag.md](./rag.md) — работа с индексом `local-rag`: что синхронизировать и что делать без него.
- [evals.md](./evals.md) — evals-слой: цены, профили, скоринг.
- [qa-web.md](./qa-web.md) — проверка веб-приложения в цикле.
- [vision.md](./vision.md) — зачем репозиторий и границы поставки.

## Архитектурные решения

[Решения (ADR)](./adr/README.md) — почему устроено именно так: раскладка продукта, строгая
типизация, граница «инфраструктура среды не в ядре», адаптеры рантайма и просмотрщика, окружение
гейтов, метрики контекста.

## Участие

- [CONTRIBUTING.md](https://github.com/DNikulshin/dev-harness/blob/main/CONTRIBUTING.md) — issue →
  ветка → PR, проверки, границы правки;
- [SECURITY.md](https://github.com/DNikulshin/dev-harness/blob/main/SECURITY.md) — приватное
  сообщение об уязвимости;
- [Вики](https://github.com/DNikulshin/dev-harness/wiki) — вход для нового участника: установка,
  команды, FAQ, диагностика.

## Адаптер рантайма

Если цикл ведётся из Pi: [`@dnikulshin/pi-harness`](https://github.com/DNikulshin/pi-harness) —
команда `/cycle` поверх CLI ядра. Контракт, который он потребляет, описан здесь (Приложение A).
