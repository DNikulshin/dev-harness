# Установка и быстрый старт

Требования: **Node.js 26.13.x** (`engines.node` = `>=26.13 <27`), **Linux или macOS** (Windows не
поддерживается), `git`. Для команд доски и гигиены веток — `gh`; для команд проекта — `pnpm`.

## 1. Поставить шаблоны в проект

```bash
npx @dnikulshin/harness init      # шаблоны .pi/, конфиг из примера, проверка раскладки
pnpm add -D @dnikulshin/harness   # дальше — команды пакета из devDependencies
```

`npx` работает без установки: проект меняется только созданными файлами. Шаблоны кладут
`.pi/agents/*`, `.pi/prompts/cycle.md`, пример `.pi/harness.config.json` и `.pi/harness.version`
(версия + `sha256` каждого файла).

Проверить раскладку в любой момент:

```bash
pnpm exec harness-check-layout
```

## 2. Настроить гейты

`.pi/harness.config.json` — **исполняемый код**, а не декларация: `executable` + `args` запускаются
от вашего имени. Минимальный рабочий конфиг — пустой список гейтов:

```json
{ "gates": [] }
```

Дальше добавляйте гейты проекта (`id`, `executable`, `args`, `required`, `dependsOn`,
`pathPrefixes`, `dbGate`, `env`). Полная схема —
[README (рус.)](https://github.com/DNikulshin/dev-harness/blob/main/README.ru.md#конфигурация-piharnessconfigjson)
и §5.5 `docs/orchestrator-core.md`.

## 3. Начать цикл

```bash
git switch -c feat/214-invoice-export
pnpm exec harness-cycle-state init \
  --issue 214 \
  --slug invoice-export \
  --branch feat/214-invoice-export
pnpm exec harness-cycle-driver next        # что делать прямо сейчас (JSON)
```

Три параметра — это три факта об одной задаче: `--slug` равен хвосту имени ветки после номера
(`^[a-z0-9-]{1,60}$`), поэтому каталог `.pi/artifacts/2026-11-22-214-invoice-export` и ветка
`feat/214-invoice-export` читаются вместе.

Ветка должна существовать и быть текущей (`init` сверяет имя с git и отказывает, если её нет), а
`base_sha` берётся из `main` — то есть `main` в репозитории уже должен быть.

Цикл живёт в `.pi/artifacts/<дата>-<issue>-<slug>/`: `state.json`, артефакты по итерациям
(`gates.<n>.json`, `decision.<n>.json`, `review.<n>.md`, `evaluation.<n>.md`) и пакет `evidence/`.

## 4. Дальше

- [Команды](Commands) — что вызывает драйвер и что каждый скрипт читает/пишет.
- [Интеграция в проект](Integration) — гейты, лимиты, ADR по раскладке.
- Если цикл ведётся из Pi, есть адаптер:
  [`@dnikulshin/pi-harness`](https://github.com/DNikulshin/pi-harness) — команда `/cycle` вместо
  ручных вызовов `bin`.
