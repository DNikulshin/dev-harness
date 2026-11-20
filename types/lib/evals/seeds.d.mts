/** Серьёзность, при которой дефект считается найденным: замечание и блокер. */
export declare const HIT_SEVERITIES: readonly string[];
/** Все серьёзности, допустимые в `expect.severities`: у оценщика нет FOLLOW-UP, у ревью есть. */
export declare const ALL_SEVERITIES: readonly string[];
export type SeedExpectation = {
    /**
     * вид сида
     */
    kind: 'clean' | 'defect';
    /**
     * минимальная серьёзность находки
     */
    severity?: 'BLOCKER' | 'MAJOR';
    /**
     * точный набор допустимых серьёзностей (для сидов вроде E1,
     * где ожидается MAJOR или FOLLOW-UP, а не «не ниже BLOCKER»)
     */
    severities?: string[];
    /**
     * файл дефекта относительно корня дерева
     */
    file?: string;
    /**
     * строка дефекта в файле «после»
     */
    line?: number;
};
export type Seed = {
    id: string;
    title: string;
    why: string;
    expect: SeedExpectation;
    issue: {
        title: string;
        body: string;
    };
    criteria: string[];
    /**
     * файлы «до»
     */
    base: Record<string, string>;
    /**
     * файлы «после»
     */
    after: Record<string, string>;
    /**
     * удалённые файлы
     */
    deleted: string[];
};
/**
 * Проверка одного сида. Ошибки собираются все: править сид удобнее за один проход.
 * @param {unknown} doc
 * @returns {{ ok: boolean, errors: string[], seed: Seed|null }}
 */
export declare function readSeed(doc: unknown): {
    ok: boolean;
    errors: string[];
    seed: Seed | null;
};
/**
 * Все сиды каталога, упорядоченные по номеру. Имя файла обязано совпадать с `id`:
 * иначе ссылка на сид в отчёте перестаёт находить файл.
 * @param {string} dir каталог сидов
 * @returns {Seed[]}
 */
export declare function loadSeeds(dir: string): Seed[];
/**
 * Числовой порядок сидов: `E2` идёт раньше `E10`, строковое сравнение дало бы наоборот.
 * @param {string} id
 * @returns {number}
 */
export declare function seedOrder(id: string): number;
/**
 * Текст `evidence/issue.md`: заголовок и тело issue дословно, как их видит агент.
 * @param {Seed} seed
 * @returns {string}
 */
export declare function seedIssueMarkdown(seed: Seed): string;
/**
 * Текст `evidence/criteria.md`: единственный источник критериев приёмки (§7).
 *
 * Формат строки — контракт ядра `CRITERION_LINE` (`lib/cycle/criteria.mjs`): `- C1: текст`,
 * двоеточие обязательно. Сид, записанный иначе, ядро не разберёт: критериев не найдётся ни
 * одного, и цикл увидит пустой набор вместо прогона сида (#34).
 * @param {Seed} seed
 * @returns {string}
 */
export declare function seedCriteriaMarkdown(seed: Seed): string;
