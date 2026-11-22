# Интеграция в проект

## Что проект задаёт, а что ядро

| Вещь                                               | Где                                   | Кто владеет |
| -------------------------------------------------- | ------------------------------------- | ----------- |
| гейты: команды, зависимости, условия запуска       | `.pi/harness.config.json` → `gates[]` | проект      |
| лимиты: итерации, стоимость, размер диффа, логи    | там же → `limits`                     | проект      |
| пути артефактов и пакета `evidence/`               | там же → `paths`                      | проект      |
| провайдер моделей и роли                           | `AGENTS.md` проекта, `.pi/agents/*`   | проект      |
| протокол стадий, схемы артефактов, правила решения | `docs/` ядра                          | ядро        |

Названий проектов, пакетов и каталогов приложений в коде ядра нет — это проверяемо: ядро берёт всё
из конфига и `AGENTS.md` потребителя.

## Гейты

Минимум — пустой список (`{ "gates": [] }`), и это валидное состояние: `cycle-gates` сообщает «гейты
не заданы» с кодом 2.

```json
{
  "gates": [
    {
      "id": "typecheck",
      "executable": "pnpm",
      "args": ["typecheck"],
      "required": true
    },
    {
      "id": "format_check",
      "executable": "pnpm",
      "args": ["format:check"],
      "required": true,
      "env": { "allow": ["npm_config_cache"], "set": { "CI": "1" } }
    }
  ]
}
```

- `required: true` — провал блокирует решение `PROCEED`;
- `dependsOn` — зависимый гейт получает `not_run` с причиной `blocked_by:<id>`;
- `pathPrefixes` — гейт запускается, только если дифф задел эти пути; иначе `skipped`
  (`not_applicable`);
- `dbGate: true` — нет базы → `not_run` (`no_database`);
- `env` — объявили, значит наследование выключено: остаются только `allow`, `set` и служебные
  `PATH`, `HOME`, `TMPDIR`.

**Модель доверия.** Гейт — код проекта: он исполняется от вашего имени и по умолчанию наследует
окружение. `env` сужает поверхность, но не делает песочницу. Решение и разбор —
[ADR 0007](https://github.com/DNikulshin/dev-harness/blob/main/docs/adr/0007-gate-env.md).

## Раскладка

Что кладёт `harness init` и что проверяет `harness-check-layout`:
[ADR 0005](https://github.com/DNikulshin/dev-harness/blob/main/docs/adr/0005-layout-profile.md) и
раздел «Установка шаблонов» в README.

Типичная ошибка: править поставленные шаблоны в проекте и ждать, что `harness init` это сохранит.
Нет: `.pi/harness.version` хранит `sha256` каждого файла, расхождение видно как локальная правка.

## Адаптер рантайма

Если цикл ведётся из Pi, отдельный пакет
[`@dnikulshin/pi-harness`](https://github.com/DNikulshin/pi-harness) даёт команду `/cycle`:
`/cycle next`, `/cycle run`, `/cycle state|gates|decision|evidence`. Адаптер потребляет только `bin`
ядра и артефакты — внутренности не импортируются
([ADR 0008](https://github.com/DNikulshin/dev-harness/blob/main/docs/adr/0008-adapter-repository.md)).
