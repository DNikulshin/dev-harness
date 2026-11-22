# Ядро цикла разработки

`@dnikulshin/harness` — детерминированный протокол
`plan → code → gates → review → evaluate → decide` для кодирующих агентов: скрипты, схема
артефактов, проверка раскладки harness и evals-слой.

Ядро не знает конкретный проект. Гейты, лимиты, пути и провайдер моделей задаёт проект в
`.pi/harness.config.json`; роли и запреты — в его `AGENTS.md`.

## С чего начать

| Страница                                     | Кому                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| [Установка и быстрый старт](Getting-Started) | первый запуск в проекте-потребителе                                    |
| [Команды](Commands)                          | что делает каждый `bin` и что читает/пишет                             |
| [Протокол цикла](Protocol)                   | стадии, артефакты, решение `cycle-decide` — обзор и ссылки             |
| [Интеграция в проект](Integration)           | `.pi/harness.config.json`, гейты, шаблоны, ADR по раскладке            |
| [FAQ](FAQ)                                   | короткие ответы: зачем ядро, чем отличается от CI, где живут артефакты |
| [Диагностика](Troubleshooting)               | коды выхода, типичные отказы, что смотреть в артефактах                |

## Нормативные источники

Вики — вход, а не норматив. Источник правды — репозиторий:

- [README](https://github.com/DNikulshin/dev-harness#readme) — требования, подключение, команды,
  гейты;
- [docs/protocol.md](https://github.com/DNikulshin/dev-harness/blob/main/docs/protocol.md) — точка
  входа в норматив протокола;
- [docs/orchestrator-core.md](https://github.com/DNikulshin/dev-harness/blob/main/docs/orchestrator-core.md)
  — реализация и Приложения A–D (схемы артефактов);
- [docs/workflow.md](https://github.com/DNikulshin/dev-harness/blob/main/docs/workflow.md) — процесс
  разработки;
- [CONTRIBUTING.md](https://github.com/DNikulshin/dev-harness/blob/main/CONTRIBUTING.md) — как
  предложить изменение.

Расхождение вики и репозитория — дефект вики: страницы правятся в репозитории, в `.github/wiki/`, и
публикуются автоматически.
