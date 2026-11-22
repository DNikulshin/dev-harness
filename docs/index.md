# Документация ядра

`@dnikulshin/harness` — детерминированный протокол
`plan → code → gates → review → evaluate → decide` для кодирующих агентов: скрипты, схема
артефактов, проверка раскладки harness и evals-слой.

Ядро не знает конкретный проект: гейты, лимиты, пути и провайдер моделей задаёт проект в
`.pi/harness.config.json`, роли — в его `AGENTS.md`.

## Быстрый старт

```bash
# 1. Шаблоны .pi/ и ядро в devDependencies проекта
npx @dnikulshin/harness init
pnpm add -D @dnikulshin/harness

# 2. Ветка задачи: <type>/<issue>-<slug> — по ней же считается base_sha
git switch -c feat/214-invoice-export

# 3. Цикл: issue, slug и ветка — три факта об одной задаче
pnpm exec harness-cycle-state init \
  --issue 214 \
  --slug invoice-export \
  --branch feat/214-invoice-export

# 4. Что делать прямо сейчас (JSON шага, его же читает адаптер Pi)
pnpm exec harness-cycle-driver next
```

Пример выше согласован по всей цепочке: `--slug invoice-export` — это хвост имени ветки после номера
(схема `^[a-z0-9-]{1,60}$`), поэтому каталог артефактов
`.pi/artifacts/2026-11-22-214-invoice-export` читается вместе с веткой `feat/214-invoice-export`.

Что важно знать до запуска:

- **`--branch` должен существовать и быть текущим**: `cycle-state init` сверяет имя с git и
  отказывает, если ветки нет;
- **`AGENTS.md` в проекте нужен заранее**: без него `harness init` ставит шаблоны, но пропускает
  проверку раскладки (`harness-check-layout`, H1–H6) и говорит об этом в выводе;
- цикл стартует от `main`: `base_sha` берётся из `git rev-parse main`.

Требования: Node.js 26.13.x, Linux или macOS. Подробно —
[README репозитория](https://github.com/DNikulshin/dev-harness#readme).

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
