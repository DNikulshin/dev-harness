#!/usr/bin/env node
import { parseCriteria } from './lib/cycle/criteria.mjs';
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
/**
 * Пункты раздела «Риски» шаблона PR: чекбоксы переносятся как есть (их отмечает человек),
 * других разделов и HTML-комментариев шаблона в результате нет. Раздела нет или он пуст —
 * пустой массив: чужой список рисков ядро не выдумывает (правило 1 `AGENTS.md`).
 * @param {string} markdown содержимое шаблона PR
 * @returns {string[]} строки пунктов с маркером списка и чекбоксом
 */
export declare function riskItems(markdown: string): string[];
export type Criterion = import('./lib/cycle/criteria.mjs').Criterion;
/**
 * @typedef {import('./lib/cycle/criteria.mjs').Criterion} Criterion
 */
export { parseCriteria };
/**
 * Гейты в порядке таблицы §5.5; неизвестные id (расширение таблицы) — после известных,
 * по алфавиту: порядок строк не должен зависеть от порядка файла.
 * @param {unknown} value `gates[].gates`
 * @param {readonly string[]} [gateIds] порядок id из конфига проекта
 * @returns {Record<string, any>[]}
 */
export declare function orderGates(value: unknown, gateIds?: readonly string[]): Record<string, any>[];
/**
 * Факты целостности проверок для раздела «Проверки» (#27). Файла `evidence/integrity.json`
 * нет — секция `integrity` в конфиге не задана, строк нет: ядро не выдумывает проверку,
 * которой нет. Своих суждений о том, «ослаблены ли тесты», скрипт не добавляет — только
 * факты из артефакта.
 * @param {Record<string, any>|null} integrity проверенный документ или `null`
 * @returns {string[]} строки markdown (пустой массив — секции нет)
 */
export declare function integrityFacts(integrity: Record<string, any> | null): string[];
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
 *   risks: string[]|null,
 *   integrity?: Record<string, any>|null,
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
    risks: string[] | null;
    integrity?: Record<string, any> | null;
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
