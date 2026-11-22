# Команды

Все команды — `bin` пакета. Ядро вызывает только `git` и `node`; сеть не нужна.

| Команда                                             | Что делает                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness-init`                                      | ставит шаблоны `.pi/`, пишет `.pi/harness.version`                                                                                                 |
| `harness-check-layout`                              | проверяет раскладку harness в текущем каталоге                                                                                                     |
| `harness`                                           | диспетчер первого запуска: `harness init`, `harness check`                                                                                         |
| `harness-cycle-driver`                              | `next` — что делать сейчас, `run` — исполнить детерминированные шаги                                                                               |
| `harness-cycle-state`                               | единственный писатель `state.json`: `init`, `get`, `advance`, `finish`, `freeze-criteria`, `apply-decision`, `escalate`, `resume`, `lock`/`unlock` |
| `harness-cycle-gates`                               | гоняет гейты итерации, пишет `gates.<n>.json` и логи `gates/<id>.<n>.log`                                                                          |
| `harness-cycle-evidence`                            | пакет `evidence/` (issue, критерии, дифф, гейты, QA), `integrity.json`                                                                             |
| `harness-cycle-decide`                              | применяет правила и пишет `decision.<n>.json`                                                                                                      |
| `harness-cycle-pr-body`                             | собирает тело PR по фактам: «Проверки» из `gates.<n>.json`                                                                                         |
| `harness-cycle-metrics`                             | `metrics.json` завершённого цикла                                                                                                                  |
| `harness-cycle-report`                              | отчёт по циклам: длительности, гейты, контекст                                                                                                     |
| `harness-cycle-usage`                               | расход токенов цикла                                                                                                                               |
| `harness-evals-collect`, `-cost`, `-pack`, `-score` | evals-слой: сбор, цена, упаковка, скоринг                                                                                                          |
| `harness-selftest`                                  | самопроверка установки                                                                                                                             |

## Правила, общие для всех команд

- **Коды выхода**: `0` — успех; `1` — отрицательный результат (гейт упал, нет ссылки в PR); `2` —
  ошибка использования или данных; `3` — конфликт состояния (недопустимый переход, живой
  `state_conflict`, терминальная стадия); `4` — `diff_too_large`.
- **Единственный писатель `state.json`** — `harness-cycle-state`. Драйвер зовёт его подпроцессом и
  таблицу переходов не дублирует.
- **Писать можно только в `.pi/artifacts/`**: путь цикла проверяется на выход из каталога
  артефактов.
- **Секреты маскируются** при захвате вывода гейтов; таблица видов — §5.4
  `docs/orchestrator-core.md`.

## Вызов из проекта

```bash
pnpm exec harness-cycle-gates --dir .pi/artifacts/2026-11-22-42-short-slug
pnpm exec harness-cycle-decide --dir .pi/artifacts/2026-11-22-42-short-slug
pnpm exec harness-cycle-pr-body --dir .pi/artifacts/2026-11-22-42-short-slug
```

Полные флаги — README и §5 `docs/orchestrator-core.md`.
