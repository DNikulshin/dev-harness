#!/usr/bin/env node
import { iterNames } from './lib/cycle/paths.mjs';
/**
 * Дедупликация пунктов «не проверено» из `decision.unverified[]` и
 * `evaluation.unverified[]`. Из пары остаётся более полная формулировка, позиция — первого
 * вхождения (порядок артефактов сохраняется, вывод детерминирован).
 * @param {string[]} items
 * @returns {string[]}
 */
export declare function dedupeUnverified(items: string[]): string[];
/**
 * Элементы markdown-списка. Строки без маркера — продолжение текущего пункта (пункт
 * остаётся одной строкой); пустая строка или заголовок закрывают пункт.
 * Локальная реализация, а не `parseListItems` из `cycle-evidence.mjs`: тот разбирает
 * тело issue и тянет за собой весь CLI оценщика, а здесь нужны только пункты `.md`.
 * @param {string} markdown
 * @returns {string[]}
 */
export declare function listItems(markdown: string): string[];
export type Criterion = {
    /**
     * `C1`, `C2`, …
     */
    id: string;
    /**
     * формулировка критерия
     */
    text: string;
};
/**
 * @typedef {object} Criterion
 * @property {string} id `C1`, `C2`, …
 * @property {string} text формулировка критерия
 */
/**
 * Критерии из `evidence/criteria.md` в её порядке: по строке `- C1: формулировка` на
 * критерий (формат `renderCriteria` в `cycle-evidence.mjs`). Пустой результат — ошибка:
 * без критериев таблица PR была бы пустой подменой.
 * @param {string} markdown
 * @returns {Criterion[]}
 */
export declare function parseCriteria(markdown: string): Criterion[];
/**
 * Гейты в порядке таблицы §5.5; неизвестные id (расширение таблицы) — после известных,
 * по алфавиту: порядок строк не должен зависеть от порядка файла.
 * @param {unknown} value `gates[].gates`
 * @param {readonly string[]} [gateIds] порядок id из конфига проекта
 * @returns {Record<string, any>[]}
 */
export declare function orderGates(value: unknown, gateIds?: readonly string[]): Record<string, any>[];
/**
 * Баннер эскалации (§5.7): причина, пояснение, `draft_pr_allowed` и открытые замечания.
 * @param {Record<string, any>} escalation проверенный `escalation.json`
 * @returns {string}
 */
export declare function renderEscalationBanner(escalation: Record<string, any>): string;
/**
 * Пункты «Что сделано»: первые `SUMMARY_LIMIT` пунктов `code-report.<n>.md`, при его
 * отсутствии — `plan.<n>.md`. Формулировки берутся из артефактов дословно, своих скрипт
 * не придумывает; маскирование (§5.4) применяет `renderPrBody`.
 * @param {string} dir каталог цикла
 * @param {ReturnType<typeof iterNames>} names имена файлов итерации
 * @returns {string[]}
 */
export declare function summaryItems(dir: string, names: ReturnType<typeof iterNames>): string[];
/**
 * Тело PR целиком. Чистая функция: файлов не читает, время и случайность не использует.
 * @param {{
 *   state: Record<string, any>,
 *   gates: Record<string, any>,
 *   review: Record<string, any>,
 *   evaluation: Record<string, any>,
 *   decision: Record<string, any>,
 *   criteria: Criterion[],
 *   summary: string[],
 *   followups: string[],
 *   escalation: Record<string, any>|null,
 *   root: string,
 *   gateIds?: readonly string[],
 * }} inputs
 * @returns {string} тело PR с завершающим переводом строки
 */
export declare function renderPrBody(inputs: {
    state: Record<string, any>;
    gates: Record<string, any>;
    review: Record<string, any>;
    evaluation: Record<string, any>;
    decision: Record<string, any>;
    criteria: Criterion[];
    summary: string[];
    followups: string[];
    escalation: Record<string, any> | null;
    root: string;
    gateIds?: readonly string[];
}): string;
/**
 * Разбирает аргументы командной строки. Любой мусор — ошибка использования (код 2).
 * @param {string[]} argv
 * @returns {{ dir: string|null, draftEscalation: boolean }}
 */
export declare function parseArgs(argv: string[]): {
    dir: string | null;
    draftEscalation: boolean;
};
