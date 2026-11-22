# Документация ядра

`@dnikulshin/harness` — детерминированный протокол
`plan → code → gates → review → evaluate → decide` для кодирующих агентов: скрипты, схема
артефактов, проверка раскладки harness и evals-слой.

Ядро не знает конкретный проект: гейты, лимиты, пути и провайдер моделей задаёт проект в
`.pi/harness.config.json`, роли — в его `AGENTS.md`.

## Быстрый старт

```bash
npx @dnikulshin/harness init      # шаблоны .pi/, конфиг из примера, проверка раскладки
pnpm add -D @dnikulshin/harness   # дальше — команды пакета
pnpm exec harness-cycle-state init --issue 42 --slug short-slug --branch feat/42-short-slug
pnpm exec harness-cycle-driver next
```

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
