# Доска Projects

Доска этого репозитория: https://github.com/users/DNikulshin/projects/6 — одна доска на репозиторий,
номер **6** (переменная репозитория `PROJECT_NUMBER`). Колонки — поле `Status`: **Todo / In progress
/ Review / Blocked / Done**.

Доска — отражение issues, а не второй список задач: карточка есть у каждого issue, руками ничего не
двигается. Источник правды — метки и состояние issue, колонка выводится из них.

## Правила вывода колонки

| Условие                           | Колонка       |
| --------------------------------- | ------------- |
| issue закрыт                      | `Done`        |
| метка `status:blocked`            | `Blocked`     |
| метка `status:in-progress`        | `In progress` |
| метка `status:review`             | `Review`      |
| иначе (в том числе `status:todo`) | `Todo`        |

Приоритет при нескольких метках: `blocked` > `in-progress` > `review`. Закрытый issue всегда `Done`,
даже если метки статуса остались.

Метки `status:*` — единственное, что влияет на колонку. `type:*`, `area:*`, `prio:*`, `size:*` на
доску не влияют и полной сверки не запускают.

## Сверка

`tooling/board-sync.mjs` — реализация правил: читает доску одним GraphQL-снимком (id проекта, поле
`Status` с опциями, карточки постранично по 100), читает issues и приводит доску к правилам.
Идемпотентен: повторный прогон ничего не дублирует и не переписывает.

```bash
pnpm board:sync        # полная сверка
pnpm board:sync:dry    # DRY_RUN=1: план в stdout, ни одной записи в проект
```

Переменные окружения:

| Переменная       | По умолчанию        | Смысл                                                          |
| ---------------- | ------------------- | -------------------------------------------------------------- |
| `PROJECT_NUMBER` | — (обязателен)      | номер доски; угадывание чужого проекта молча — хуже ошибки     |
| `OWNER`          | `@me`               | владелец проекта; `@me` резолвится в логин через `gh api user` |
| `REPO`           | текущий репозиторий | где читать issues (`gh repo view`)                             |
| `LIMIT`          | `500`               | сколько issues и карточек читать за прогон                     |
| `DRY_RUN`        | пусто               | непустое значение — только план, записей нет                   |

Коды выхода: `0` — доска сверена (в `DRY_RUN` — план показан); `2` — ошибка параметров, проекта или
доски (нет поля `Status`, нет колонки, выдача усечена `LIMIT`); `1` — прочий отказ `gh`.

Защита от усечения: если карточек на доске или issues в репозитории больше `LIMIT`, прогон
отменяется с подсказкой, каким `LIMIT` перезапустить. Иначе часть данных молча выпала бы из снимка,
и синк принял бы недостающие карточки за отсутствующие.

## Автоматика

| Workflow                                                                      | Что делает                                                                                        | Чем авторизуется    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------- |
| [`.github/workflows/board-sync.yml`](../.github/workflows/board-sync.yml)     | полная сверка: открытие/закрытие issue, `status:*`, события PR, раз в сутки и вручную             | PAT `PROJECT_TOKEN` |
| [`.github/workflows/board-labels.yml`](../.github/workflows/board-labels.yml) | переключает метки `status:*` по событиям PR (draft → in-progress, ready → review, closed → снять) | `GITHUB_TOKEN`      |

Разделение прав: метки доступны `GITHUB_TOKEN`, а карточки и поле `Status` в Projects v2 — нет,
поэтому сверка вынесена в отдельный workflow с PAT. Пока секрета нет, `board-sync.yml` падает с
инструкцией: молчаливый пропуск расходится с репозиторием, а прогон остаётся зелёным.

## Секрет `PROJECT_TOKEN`

```bash
# 1. Classic PAT: scopes project + repo
#    https://github.com/settings/tokens/new?scopes=project,repo&description=dev-harness-board-sync
# 2. В секрет репозитория
gh secret set PROJECT_TOKEN
# 3. Номер доски — переменной репозитория, а не константой в workflow
gh variable set PROJECT_NUMBER --body 6
```

Почему classic, а не fine-grained: `gh project` проверяет классические scopes токена и на
fine-grained падает ещё до запроса — `your authentication token is missing required scopes`. Если
`gh` это исправит, хватит fine-grained с `Projects: Read and write`.

Почему `OWNER: '@me'`: `gh project … --owner <логин>` сначала определяет тип владельца запросом
`user(login:)`, и токен без этого запроса не даёт результата (`unknown owner type`). `@me`
резолвится через `viewer` и работает с обоими типами токена; репозиторий передаётся отдельно
(`REPO`).

Истёкший токен выглядит так же, как отсутствующий: шаг «Проверить, что PROJECT_TOKEN задан»
пропускает пустой секрет, а `gh` отвечает отказом. Продлить/выпустить новый PAT и повторить
`gh secret set PROJECT_TOKEN`.

## Метки

Метки `status:*` создаются один раз (цвета фиксированы: одинаковые метки должны выглядеть одинаково
во всех проектах):

```bash
gh label create status:todo        --color ededed --description "Бэклог, можно брать в работу" --force
gh label create status:in-progress --color fbca04 --description "В работе" --force
gh label create status:review      --color 0e8a16 --description "Ждёт проверки владельца" --force
gh label create status:blocked     --color b60205 --description "Заблокировано" --force
```

## Проверка без записи

Скрипт и правила покрыты `node --test` (`tooling/board-sync.test.mjs`): план, приоритет меток,
страницы и лимиты, и главное — в `DRY_RUN` не выполняется ни одного `gh project item-add` /
`item-edit`. Тесты подставляют своего исполнителя `gh`, поэтому сети не требуют.
