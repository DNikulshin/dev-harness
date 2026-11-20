#!/usr/bin/env node
/**
 * Сбор ответа субагента в каталог прогона (docs/evals.md).
 *
 * Зачем отдельный шаг: pi сохраняет ответ субагента в двух местах, и они не равноценны.
 * `<id>_<agent>_output.md` обрезается по размеру (наблюдалось на ответах оценщика
 * длиннее ~5 КБ), а полный текст последнего сообщения лежит в
 * `<id>_<agent>_transcript.jsonl`. Скоринг обязан видеть полный ответ, иначе валидный
 * блок ```json теряется и этап выглядит сломанным.
 *
 * Скрипт делает два дела и ничего больше:
 *
 * 1. вытаскивает текст последнего ответа ассистента из транскрипта и пишет его в
 *    `<run>/<stage>.md`;
 * 2. дописывает в `<run>/usage.json` фактические токены этого прогона — из тех же
 *    записей транскрипта. Стоимость в `evals-score` считается по ним, а не по среднему
 *    профилю, поэтому цифры в отчёте остаются фактом.
 *
 * Пишет только внутрь `.pi/artifacts/evals/`. Сеть не используется.
 *
 * Коды выхода: `0` — ответ собран; `2` — ошибка использования или данных.
 * Shebang нужен: файл запускается напрямую.
 */
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { isDirectRun } from './lib/cycle/cli.mjs';
import { SCORED_STAGES } from './lib/evals/score.mjs';
import {
  addUsage,
  emptyUsage,
  lastAssistantText,
  readTranscript,
  sumUsage,
} from './lib/evals/usage.mjs';
import { readJson, writeJsonAtomic, writeTextAtomic } from './lib/cycle/io.mjs';
import { loadConfig, takeConfigOption } from './lib/cycle/config.mjs';
import { artifactsDir, repoRoot } from './lib/cycle/paths.mjs';

/**
 * Разбирает аргументы командной строки.
 * @param {string[]} argv
 * @returns {{ run: string|null, stage: string|null, transcript: string|null, out: string|null, root: string|null }}
 */
export function parseArgs(argv) {
  /** @type {{ run: string|null, stage: string|null, transcript: string|null, out: string|null, root: string|null }} */
  const args = { run: null, stage: null, transcript: null, out: null, root: null };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) break;
    const key = arg.startsWith('--') ? arg.slice(2) : null;
    if (
      key === 'run' ||
      key === 'stage' ||
      key === 'transcript' ||
      key === 'out' ||
      key === 'root'
    ) {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
        throw new Error(`${arg}: ожидается значение`);
      }
      args[/** @type {'run'|'stage'|'transcript'|'out'|'root'} */ (key)] = value.trim();
      index += 1;
      continue;
    }
    throw new Error(`неизвестный аргумент: ${arg}`);
  }

  return args;
}

/**
 * Точка входа CLI.
 * @returns {void}
 */
function main() {
  try {
    const cli = takeConfigOption(process.argv.slice(2));
    const args = parseArgs(cli.argv);
    if (args.run === null) throw new Error('--run: обязателен (каталог прогона)');
    const stage = args.stage;
    if (stage === null || !SCORED_STAGES.includes(/** @type {any} */ (stage))) {
      throw new Error(`--stage: ожидается ${SCORED_STAGES.join('|')}`);
    }
    if (args.transcript === null) throw new Error('--transcript: обязателен (путь к *.jsonl)');

    const root = args.root === null ? repoRoot() : resolve(args.root);
    const config = loadConfig(root, { file: cli.file });
    const runDir = resolve(args.run);
    const evalsRoot = join(artifactsDir(root, config), 'evals');
    if (!runDir.startsWith(`${evalsRoot}${sep}`)) {
      throw new Error(
        `каталог прогона должен быть внутри ${join(config.paths.artifactsDir, 'evals')}`,
      );
    }
    if (!existsSync(join(runDir, 'meta.json'))) {
      throw new Error('в каталоге прогона нет meta.json: сначала evals-pack');
    }

    const records = readTranscript(args.transcript);
    if (records.length === 0) throw new Error('транскрипт пуст или не читается');

    const text = lastAssistantText(records);
    if (text.trim() === '') throw new Error('в транскрипте нет текстового ответа ассистента');

    const outName = args.out ?? `${args.stage}.md`;
    writeTextAtomic(join(runDir, outName), `${text}\n`);

    const usageFile = join(runDir, 'usage.json');
    /** @type {Record<string, import('./lib/cycle/cost.mjs').StageUsage>} */
    const usage = existsSync(usageFile)
      ? /** @type {Record<string, import('./lib/cycle/cost.mjs').StageUsage>} */ (
          readJson(usageFile)
        )
      : {};
    const previous = stage === null ? undefined : usage[stage];
    const base = previous === undefined ? emptyUsage() : { ...emptyUsage(), ...previous };
    if (stage !== null) usage[stage] = addUsage(base, sumUsage(records));
    writeJsonAtomic(usageFile, usage, {
      serialize: (data) => `${JSON.stringify(data, null, 2)}\n`,
    });

    const hasBlock = text.includes('```json');
    const stageUsage = stage === null ? null : usage[stage];
    process.stdout.write(
      [
        `собрано: ${join(runDir, outName)}`,
        `  стадия: ${stage}, символов: ${text.length}, блок json: ${hasBlock ? 'есть' : 'НЕТ'}`,
        `  токены: вход ${stageUsage?.input ?? 0}, кэш ${stageUsage?.cache_read ?? 0}, вывод ${stageUsage?.output ?? 0}`,
        '',
      ].join('\n'),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`evals-collect: ${message}\n`);
    process.exitCode = 2;
  }
}

// Модуль импортируется тестами ради чистых функций; CLI запускается только напрямую.
if (isDirectRun(import.meta.url)) main();
