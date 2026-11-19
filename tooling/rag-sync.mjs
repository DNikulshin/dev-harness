#!/usr/bin/env node
/**
 * Инкрементальная синхронизация индекса local-rag с `docs/` репозитория.
 *
 * Зачем: индекс обновляется не только в начале сессии, но и после мержа PR — иначе агент
 * видит устаревшие документы. Скрипт вызывается из `.githooks/post-merge` (после `git pull`
 * и merge) и вручную: `pnpm rag:sync`.
 *
 * Копия `scripts/rag-sync.mjs` из hair-lab: это инфраструктура среды, а не механизм цикла
 * (ADR [0003](../docs/adr/0003-environment-infrastructure.md)). Она знает про машину — версию
 * MCP-сервера, пути LanceDB и общую базу нескольких проектов, — поэтому в пакет не входит и
 * потребителю не поставляется: потребитель получает правило (`AGENTS.md`, `docs/rag.md`).
 * Копия осознана: доменной логики здесь нет, расходиться нечему, цена — строка версии ниже.
 *
 * Пути совпадают с MCP-сервером `local-rag` из `~/.pi/agent/mcp.json`; переопределяются
 * переменными `LOCAL_RAG_DB_PATH`, `LOCAL_RAG_CACHE_DIR`, `LOCAL_RAG_BASE_DIRS`.
 * База общая для нескольких проектов, поэтому синхронизируется только `docs/` этого репозитория.
 *
 * Скрипт никогда не роняет вызывающую команду: любая проблема — предупреждение и код 0.
 * Если MCP-сервер держит LanceDB, синк может не пройти — тогда повторите позже или
 * воспользуйтесь `local-rag_sync_start`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Версия пакета должна совпадать с `mcp.json` MCP-сервера, иначе разойдутся модель/формат индекса. */
const LOCAL_RAG_VERSION = '0.23.0';
const SYNC_TIMEOUT_MS = 120_000;

const DB_PATH =
  process.env.LOCAL_RAG_DB_PATH ?? join(homedir(), '.local/share/mcp-local-rag/lancedb');
const CACHE_DIR = process.env.LOCAL_RAG_CACHE_DIR ?? join(homedir(), '.cache/mcp-local-rag');
const BASE_DIRS = process.env.LOCAL_RAG_BASE_DIRS ?? JSON.stringify([join(homedir(), 'projects')]);
const IGNORE_PATHS = JSON.stringify([
  '**/.git/**',
  '**/node_modules/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/.turbo/**',
]);

/**
 * Первая строка сообщения об ошибке: в лог хука не должно попадать многострочное полотно.
 * @param {unknown} error
 * @returns {string}
 */
function firstLine(error) {
  const reason = error instanceof Error ? error.message : String(error);
  return reason.split('\n')[0] ?? '';
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const docs = resolve(root, 'docs');

  if (!existsSync(docs)) {
    console.log('rag-sync: каталога docs/ нет, синхронизация пропущена');
    return;
  }

  try {
    const output = execFileSync(
      'npx',
      [
        '-y',
        `mcp-local-rag@${LOCAL_RAG_VERSION}`,
        '--db-path',
        DB_PATH,
        '--cache-dir',
        CACHE_DIR,
        'sync',
        docs,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: SYNC_TIMEOUT_MS,
        env: {
          ...process.env,
          BASE_DIRS,
          IGNORE_PATHS,
        },
      },
    );
    // CLI печатает сводку как JSON без перевода строки — вытаскиваем её из вывода.
    const summary = /\{"upserted":\d+.*?\}/.exec(output)?.[0];
    console.log(`rag-sync: docs/ синхронизирован ${summary ?? '(без сводки)'}`);
  } catch (error) {
    console.warn(`rag-sync: синхронизация не удалась (${firstLine(error)}), индекс не обновлён`);
  }
}

main();
