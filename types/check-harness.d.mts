#!/usr/bin/env node
export type AgentName = 'plan' | 'code' | 'review' | 'evaluate';
/**
 * Имя роли в `.pi/agents/`. Один список — один тип: расширение ролей идёт правкой
 * `AGENT_NAMES`, а не вторым перечислением.
 * @typedef {'plan'|'code'|'review'|'evaluate'} AgentName
 */
/** Агенты проекта в порядке вывода H1 (§5.9). */
export declare const AGENT_NAMES: readonly AgentName[];
/** Имена этапов автомата `cycle-state.mjs` (§5.3) — их должен знать `cycle.md` (H6). */
export declare const STAGES: readonly string[];
export type LayoutPaths = {
    agentsDir: string;
    settings: string;
    cyclePrompt: string;
    agentsMd: string;
};
export type AgentDoc = {
    name: string;
    file: string;
    fields: Record<string, string | string[]> | null;
};
export type HarnessInput = {
    agents: AgentDoc[];
    settings: unknown;
    cycleText: string;
    agentsMdText: string;
    provider?: string;
    paths?: LayoutPaths;
};
export type Violation = {
    rule: string;
    file: string;
    messages: string[];
};
export type Warning = {
    rule: string;
    file: string;
    message: string;
};
/**
 * Разбирает frontmatter агента: блок между строками `---`, строки `key: value`,
 * значения в одинарных или двойных кавычках, `tools` — список через запятую.
 * @param {string} text содержимое файла целиком
 * @returns {{ ok: true, fields: Record<string, string | string[]> } | { ok: false, error: string }}
 */
export declare function parseFrontmatter(text: string): {
    ok: true;
    fields: Record<string, string | string[]>;
} | {
    ok: false;
    error: string;
};
/**
 * Читает входы проверки из `root`. Ошибки чтения (нет файла, битый JSON/frontmatter)
 * бросаются исключением: молча подставлять пустое значение нельзя — это скрыло бы
 * сломанный harness за «нарушением правил».
 * @param {string} root корень дерева (репозиторий или фикстура)
 * @returns {HarnessInput}
 */
export declare function readHarness(root: string, config?: Readonly<{
    gates: ReadonlyArray<import("./lib/cycle/config.mjs").LoadedGate>;
    limits: import("./lib/cycle/config.mjs").Limits;
    limitsExplicit: readonly string[];
    paths: import("./lib/cycle/config.mjs").Paths;
    evals: import("./lib/cycle/config.mjs").EvalsPaths;
    qaWeb: {
        pathPrefixes: readonly string[];
    };
    integrity: import("./lib/cycle/config.mjs").IntegrityRules;
    provider: string;
    gateTimeouts: Record<string, number>;
}>): HarnessInput;
/**
 * Семейство модели: второй сегмент `acme-ai/<семейство>/<модель>`.
 * `null` — семейство вычислить нельзя (нет префикса, один сегмент); такие агенты
 * H2 пропускает, их разбирают H1 и H4.
 * @param {string | string[] | undefined} model
 * @returns {string | null}
 */
export declare function familyOf(model: string | string[] | undefined, provider?: string): string | null;
/**
 * Применяет правила H1–H6 к уже прочитанным входам. Чистая функция: файлов не читает,
 * порядок вывода не зависит от порядка ключей объектов.
 * Возвращает и нарушения (влияют на код выхода), и предупреждения `W2` (только видимость).
 * @param {HarnessInput} input
 * @returns {{ violations: Violation[], warnings: Warning[] }}
 */
export declare function analyzeHarness(input: HarnessInput): {
    violations: Violation[];
    warnings: Warning[];
};
/**
 * Нарушения раскладки: то, из-за чего проверка падает (код выхода 1).
 * @param {HarnessInput} input
 * @returns {Violation[]}
 */
export declare function evaluateHarness(input: HarnessInput): Violation[];
/**
 * Предупреждения `W2`: допустимые конфигурации, которые нужно видеть, но не ломать.
 * @param {HarnessInput} input
 * @returns {Warning[]}
 */
export declare function harnessWarnings(input: HarnessInput): Warning[];
/**
 * Находит в тексте идентификаторы моделей в порядке первого появления, без повторов
 * (сравнение без учёта регистра). Возвращает найденные написания как есть. Префикс
 * провайдера берётся из конфига проекта и экранируется как литерал.
 * @param {string} text
 * @param {string} [provider]
 * @returns {string[]}
 */
export declare function findModelIdentifiers(text: string, provider?: string): string[];
/**
 * Строка вывода одной строкой: `H<n>: <файл> — <что не так>`.
 * @param {Violation} violation
 * @returns {string}
 */
export declare function formatViolation(violation: Violation): string;
/**
 * Строка предупреждения одной строкой: `W2: <файл> — <что не так>`.
 * @param {Warning} warning
 * @returns {string}
 */
export declare function formatWarning(warning: Warning): string;
/**
 * Разбирает аргументы CLI: единственный необязательный — `--root <dir>`.
 * Без него проверяется текущий каталог (см. `DEFAULT_ROOT`).
 * @param {string[]} argv
 * @returns {{ root: string }}
 */
export declare function parseArgs(argv: string[]): {
    root: string;
};
