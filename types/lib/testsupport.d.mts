/** Скрипты запущены из установленного пакета (`node_modules`), а не из репозитория ядра. */
export declare const INSTALLED_COPY: boolean;
/**
 * Опции `node:test` для проверок, которым нужен репозиторий ядра: `test(name, REPO_ONLY, fn)`.
 * В репозитории `skip` ложно, поэтому проверка выполняется как обычно.
 */
export declare const REPO_ONLY: Readonly<{
    skip: "нужен репозиторий ядра: пакет установлен в node_modules" | false;
}>;
