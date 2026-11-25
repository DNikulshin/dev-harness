---
description: Цикл plan → code → gates → review → evaluate → decide по протоколу оркестратора
argument-hint: '<номер issue и что сделать>'
---

Задача: ${@:-<номер issue и что сделать>}

Ты супервизор цикла. Читаешь `AGENTS.md` (команды, границы слоёв, ПДн, git-процесс) и Приложение B
`docs/orchestrator-core.md` (канонический порядок). Маршрут ведёт драйвер, а не ты: `state.json`
правит только `cycle-state`, переходы разрешает только он, `action` из `decision.<n>.json` не
пересматривается, PR не мержится.

Каталог: `.pi/artifacts/<YYYY-MM-DD>-<номер>-<slug>/` (в `.gitignore`). `--dir` у скриптов по
умолчанию — единственный активный цикл.

## Маршрут

Перед каждым шагом — `node scripts/cycle-driver.mjs next`. Он вернёт `action`, `reason` и
`commands`, посчитанные по `state.json`, артефактам и `decision.<n>.json`. Ничего не додумывай: если
справка ниже и `next` расходятся, прав драйвер.

| `action`                     | что делаешь                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `run` / `advance` / `finish` | выполняешь `commands` дословно (или `node scripts/cycle-driver.mjs run` — всё детерминированное подряд) |
| `spawn`                      | запускаешь субагента `spawn.agent` с указанным входом, кладёшь артефакт, закрываешь стадию `finish`     |
| `handoff`                    | работа твоя: браузерная проверка, бриф доработки, коммиты, PR                                           |
| `stop`                       | цикл закончен                                                                                           |
| `blocked`                    | стоп и вопрос владельцу (`stage_status = error` — повтори этап или эскалируй)                           |

Драйвер пишет журнал `driver.jsonl`; `metrics.json` показывает по нему блок `driver`. Повторный
`next` на том же дереве ответ не меняет.

## INIT — единственное, что до драйвера

1. `node scripts/cycle-state.mjs lock` — одна блокировка на дерево.
2. `gh issue view <N> --json title,body,labels > <dir>/issue.json` — вход для критериев.
3. Ветка от `main`: `feat|fix|chore|data|design/<номер>-<коротко>`, переключиться на неё.
4. `node scripts/cycle-state.mjs init --issue <N> --slug <slug> --branch <ветка>`.

Дальше — только `next`. Код 3 на `freeze-criteria` (`criteria_drift`) →
`escalate --reason criteria_drift`: цель меняет владелец, подтверждение —
`freeze-criteria --owner-approved` после правки issue и повторного `cycle-evidence criteria`.

## Передача моделям (`spawn`)

Агент и его вход названы в `next.spawn`; промпт — `.pi/agents/<agent>.md`.

- `plan` — план по `issue.json` и `evidence/criteria.md`, файлы не правит → `plan.<n>.md`; просит
  выбрать вариант → `escalate --reason plan_ambiguous`, стоп.
- `code` — правки по плану и требованиям `AGENTS.md`, прогоняет проверки; отчёт →
  `code-report.<n>.md` (что изменено, вывод проверок, «не проверено» с причиной). Файлы правит
  только `code`.
- `review` — план, `git diff <base_sha>` и `evidence/` → `review.<n>.md` с последним блоком
  ```json (обязателен).

  ```
- `evaluate` — **только** `evidence/` (план, отчёт кода и ревью не передаются: оценка слепая) →
  `evaluation.<n>.md`.

`review.<n>.json` и `evaluation.<n>.json` руками не пишет никто: их извлекает `cycle-decide`.

## Твоя работа (`handoff`)

- **QA_WEB** — только при web-диффе (`qaWeb.pathPrefixes`): сценарий `docs/qa-web.md` в браузере
  (production-сборка — по инструкции из `AGENTS.md`) → сырые факты в `qa-web.json`, `id` шагов `s1`,
  `s2`, … по формату `docs/qa-web.md`. MCP недоступен —
  `{"status": "not_run", "reason": "<причина>", "steps": []}` (поле `steps` обязательно при любом
  `status`). ПДн не пишем.
- **REWORK** — `rework-brief.<n>.md` из `rework_items` решения дословно; лимит итераций —
  `max_iterations`, сверх него только `advance --to CODE --owner-approved` с разрешения владельца.
- **ACQUIRE_EVIDENCE** — этап-учёт: `finish`, затем все пункты `acquire[]` по одному разу через их
  этапы (`gate:<id>` → `GATES` с `--only`, `qa-web` → `QA_WEB`, `integrity` → повтор `REVIEW` с
  вопросом «не ослаблены ли проверки»; сначала гейт, потом браузер).
- **PR** — сначала `followups.md` (замечания вне скоупа, до сборки тела, иначе раздел «Вне скоупа»
  пуст), потом коммиты (`<type>(<scope>): <что>`), `git push -u origin <ветка>`, тело —
  `node scripts/cycle-pr-body.mjs`, `gh pr create --body-file …`, метка `status:review`. **PR не
  мержить.**
- **ESCALATE** — комментарий в issue, `status:blocked`, `needs-owner`; draft PR только при
  `escalation.draft_pr_allowed` (`cycle-pr-body --draft-escalation`).
- **Расход** — после каждого этапа с моделью (`PLAN`, `CODE`, `REVIEW`, `EVALUATE`):
  `node scripts/cycle-usage.mjs --dir <dir> --stage <plan|code|review|evaluate> --transcript <id>_<agent>_transcript.jsonl`
  (транскрипты — `~/.pi/agent/sessions/<проект>/subagent-artifacts/`). Без этого `metrics.json`
  пишет `tokens` и `cost_rub` как `null`: «не измеряли», а не «ноль».

## DONE и ESCALATED

Терминальные стадии, вперёд перехода нет. `DONE` — после мержа владельцем и `git pull` (цикл видит
свой PR смерженным): `advance --to DONE`, затем метрики и `unlock` — их вернёт `next`. `ESCALATED` —
цикл закрыт, метрики пишутся так же, `unlock` обязателен.

## Правила

- проверки — строго в порядке, заданном `gates` в `.pi/harness.config.json` проекта; в PR только
  фактические результаты;
- не расширяй скоуп, не трогай `.env*`, `node_modules`, lockfile без причины; контракты только
  обратно совместимые, БД — только миграциями expand/contract;
- замечания вне скоупа — в `followups.md`, итерацию они не запускают;
- «не проверено» всегда с причиной; «проверено» без запуска не пишем.

Итог в ответе: ссылка на PR, ветка, изменённые файлы, итераций из `state.json`, результаты гейтов и
оценки, follow-ups.
