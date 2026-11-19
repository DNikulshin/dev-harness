#!/usr/bin/env node
/**
 * Pre-commit проверка: ветка, форматирование и раскладка harness по изменённым файлам.
 *
 * Запускается git-хуком `.githooks/pre-commit` (подключается `prepare`-скриптом:
 * `git config core.hooksPath .githooks`). Вручную: `pnpm precommit`.
 *
 * Правила:
 * - защищённая ветка (`main`/`master`) — отказ до запуска инструментов: работа идёт
 *   в ветке по задаче, merge делает владелец через PR (`tooling/git-guard.mjs`);
 * - смотрим только файлы из индекса (staged), удалённые не проверяем;
 * - prettier запускается с `--write`, исправленные файлы возвращаются в индекс;
 *   `.prettierignore` действует как обычно (сгенерированное и норматив не трогаем);
 * - `check-harness` — только если тронут `.pi/**` (агенты, настройки, промпт цикла):
 *   правка может сломать H1–H6 раньше, чем это увидит CI;
 * - полный `typecheck` и тесты осознанно не запускаем: это делает CI (`pnpm check`),
 *   иначе коммит станет медленным.
 *
 * Хук обходится `git commit --no-verify`; правки не теряются — они уже в рабочем дереве.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { commitBlockReason, normalizeBranch } from './git-guard.mjs';

const PRETTIER_FILES = /\.(?:md|mdx|json|jsonc|ya?ml|ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/;
/** Harness агентов: правка `.pi/**` может сломать H1–H6 (docs/orchestrator-core.md §5.9). */
const HARNESS_FILES = /^\.pi\//;

/**
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/**
 * Запуск шага с наследованием вывода: код возврата пробрасывается.
 * @param {string} command
 * @param {string[]} args
 * @returns {void}
 */
function run(command, args) {
  try {
    execFileSync(command, args, { stdio: 'inherit' });
  } catch (error) {
    process.exit(
      typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 1,
    );
  }
}

/**
 * @param {string[]} files
 * @returns {void}
 */
function restage(files) {
  if (files.length === 0) return;
  git(['add', '--', ...files]);
}

/**
 * @typedef {{ label: string, command: string, args: string[], files: string[] }} Step
 */

function main() {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  process.chdir(root);

  // Проверка ветки — первой: не тратим время на prettier ради коммита, который
  // всё равно нельзя делать в `main` (docs/workflow.md).
  const blocked = commitBlockReason(normalizeBranch(git(['rev-parse', '--abbrev-ref', 'HEAD'])));
  if (blocked !== null) {
    process.stderr.write(`${blocked}\n`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(resolve(root, 'node_modules/.bin/prettier'))) {
    console.log(
      'pre-commit: зависимости не установлены, проверка пропущена (нужен `pnpm install`)',
    );
    return;
  }

  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter((file) => file.length > 0 && existsSync(resolve(root, file)));

  if (staged.length === 0) {
    console.log('pre-commit: нет staged-файлов, пропускаем');
    return;
  }

  /** @type {Step[]} */
  const steps = [];

  const formatted = staged.filter((file) => PRETTIER_FILES.test(file));
  if (formatted.length > 0) {
    steps.push({
      label: 'prettier',
      command: 'pnpm',
      args: ['exec', 'prettier', '--write'],
      files: formatted,
    });
  }

  for (const step of steps) {
    console.log(`pre-commit: ${step.label} — ${step.files.length} файл(ов)`);
    run(step.command, [...step.args, '--', ...step.files]);
    // Prettier правит файлы на месте: возвращаем исправления в индекс.
    restage(step.files);
  }

  const harness = staged.filter((file) => HARNESS_FILES.test(file));
  if (harness.length > 0) {
    console.log(`pre-commit: check-harness — ${harness.length} файл(ов) в .pi/`);
    run('node', ['scripts/check-harness.mjs']);
  }

  console.log('pre-commit: готово');
}

main();
