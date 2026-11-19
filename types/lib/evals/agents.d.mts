import { loadConfig } from '../cycle/config.mjs';
/**
 * Модели стадий из агентов.
 *
 * Ключи — имена агентов (`plan`, `code`, `review`, `evaluate`), значения — идентификаторы
 * моделей без префикса провайдера, то есть в том виде, в каком они встречаются в
 * `evals/prices.json`. Агент без файла или без модели — исключение: конфигурация
 * неполная, и считать по ней цикл нельзя.
 * @param {string} root корень дерева (репозиторий или фикстура)
 * @param {ReturnType<typeof loadConfig>} [config] конфиг проекта: пути и префикс провайдера
 * @returns {Record<string, string>}
 */
export declare function readAgentModels(root: string, config?: ReturnType<typeof loadConfig>): Record<string, string>;
