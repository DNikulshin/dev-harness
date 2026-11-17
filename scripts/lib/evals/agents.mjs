/**
 * Текущая конфигурация моделей из `.pi/agents/*.md` (docs/evals.md).
 *
 * Единственный источник истины о том, кто на какой модели работает — frontmatter агентов.
 * Дублировать модели в `evals/*.json` нельзя: конфигурация разъедется с harness, и отчёт
 * будет считать деньги для моделей, которые уже не запускаются.
 *
 * Разбор frontmatter переиспользуется из `check-harness.mjs`: там же живут имена агентов
 * и правило H4 о префиксе провайдера, поэтому второй парсер означал бы второе мнение
 * о формате файла.
 *
 * Shebang не нужен: модуль подключается из CLI-скриптов `evals-*.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_NAMES, parseFrontmatter } from '../../check-harness.mjs';
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
export function readAgentModels(root, config = loadConfig(root)) {
  /** @type {Record<string, string>} */
  const models = {};

  for (const name of AGENT_NAMES) {
    const label = `${config.paths.agentsDir}/${name}.md`;
    const file = join(root, config.paths.agentsDir, `${name}.md`);
    if (!existsSync(file)) throw new Error(`${label}: файла нет, конфигурацию не определить`);

    const parsed = parseFrontmatter(readFileSync(file, 'utf8'));
    if (!parsed.ok) throw new Error(`${label}: битый frontmatter (${parsed.error})`);

    const raw = parsed.fields.model;
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error(`${label}: не задано поле model`);
    }

    const model = raw.trim();
    if (!model.startsWith(config.provider)) {
      throw new Error(`${label}: model должен начинаться с ${config.provider} (правило H4)`);
    }
    const id = model.slice(config.provider.length);
    if (id === '') throw new Error(`${label}: пустой идентификатор модели`);
    models[name] = id;
  }

  return models;
}
