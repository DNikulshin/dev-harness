/**
 * Поддержка тестов, которым нужен контекст репозитория `dev-harness`.
 *
 * Почти все тесты ядра самодостаточны: они собирают временные каталоги и фикстуры. Но часть
 * проверок описывает факты самого репозитория — корень репозитория по умолчанию (правила H1–H6
 * ищут `.pi/settings.json` рядом со `scripts/`), `repoRoot()` в связке с `AGENTS.md`, сиды
 * `evals/orchestrator/seeds`, снапшот цен `evals/prices.json`. В установленном пакете этого
 * контекста нет: скрипты лежат в `node_modules/@dnikulshin/harness/scripts`, а данные
 * репозитория (`evals/`, `.pi/`) пакет не поставляет — потребитель приносит свои.
 *
 * Поэтому такие проверки не падают, а пропускаются с причиной: иначе `harness-selftest`
 * в проекте-потребителе был бы красным всегда, и провал перестал бы что-то значить.
 *
 * Shebang не нужен: модуль подключается только из тестов.
 */
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Скрипты запущены из установленного пакета (`node_modules`), а не из репозитория ядра. */
export const INSTALLED_COPY = fileURLToPath(import.meta.url).includes(`${sep}node_modules${sep}`);

/**
 * Опции `node:test` для проверок, которым нужен репозиторий ядра: `test(name, REPO_ONLY, fn)`.
 * В репозитории `skip` ложно, поэтому проверка выполняется как обычно.
 */
export const REPO_ONLY = Object.freeze({
  skip: INSTALLED_COPY ? 'нужен репозиторий ядра: пакет установлен в node_modules' : false,
});
