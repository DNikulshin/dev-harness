# Протокол цикла

Обзор для человека, который впервые видит протокол. Норматив — в репозитории:
[docs/protocol.md](https://github.com/DNikulshin/dev-harness/blob/main/docs/protocol.md),
[docs/orchestrator.md](https://github.com/DNikulshin/dev-harness/blob/main/docs/orchestrator.md)
(политика),
[docs/orchestrator-core.md](https://github.com/DNikulshin/dev-harness/blob/main/docs/orchestrator-core.md)
(реализация).

## Стадии

`INIT → PLAN → CODE → GATES → QA_WEB → REVIEW → EVALUATE → DECIDE → (REWORK → CODE | PR) → DONE`, из
любого места возможен `ESCALATED` (эскалация владельцу) и `ACQUIRE_EVIDENCE` (добор свидетельств по
решению).

Переходы делает `harness-cycle-state advance`; маршрутизацию «что дальше» — `harness-cycle-driver`.

## Что решает код, а что — человек или модель

| Шаг                         | Кто                      | Чем проверяется                                      |
| --------------------------- | ------------------------ | ---------------------------------------------------- |
| гейты проекта               | `harness-cycle-gates`    | код возврата команды, `gates.<n>.json`               |
| пакет `evidence/`           | `harness-cycle-evidence` | состав и дифф, `integrity.json`                      |
| решение                     | `harness-cycle-decide`   | правила по гейтам/ревью/оценке → `decision.<n>.json` |
| план, код, ревью, оценка    | модель по шаблону роли   | `review.<n>.md`, `evaluation.<n>.md`                 |
| переход в `PR`, `ESCALATED` | владелец                 | подтверждение и подпись в артефактах                 |

Драйвер исполняет только детерминированные шаги (`run`/`advance`/`finish`) и останавливается на
`spawn`/`handoff`/`stop`/`blocked`.

## Артефакты цикла

| Файл                                 | Смысл                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `state.json`                         | стадия, итерация, история, критерии, эскалация — схема в Приложении A                                                    |
| `gates.<n>.json`                     | гейты итерации: статус, код возврата, длительность, лог                                                                  |
| `review.<n>.md`, `evaluation.<n>.md` | вердикт и находки (внутри — блок ```json)                                                                                |
| `decision.<n>.json`                  | `action` (`PROCEED`, `REWORK`, `ACQUIRE_EVIDENCE`, `RETRY_STAGE`, `ESCALATE`, `PROCEED_WITH_UNVERIFIED`), причины, добор |
| `evidence/`                          | замороженный вход оценщика: issue, критерии, дифф, гейты, QA                                                             |
| `metrics.json`, `usage.json`         | телеметрия завершённого цикла                                                                                            |

## Заморозка критериев

`harness-cycle-state freeze-criteria` пишет `criteria_sha256` — дайджест пар `[id, формулировка]` из
`issue.json`. Расхождение критериев ловится четырьмя командами и даёт код 2 `criteria_drift`: цель
нельзя подменить после первой заморозки.
