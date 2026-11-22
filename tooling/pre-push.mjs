#!/usr/bin/env node
/**
 * `pre-push`-проверки: запрет push в защищённые ветки (`main`, `master`) и запрет push
 * ветки, чей PR уже смержен.
 *
 * Запускается git-хуком `.githooks/pre-push` (подключается `prepare`-скриптом:
 * `git config core.hooksPath .githooks`). git передаёт список ref не аргументами, а stdin:
 * `<local ref> <local sha> <remote ref> <remote sha>`.
 *
 * Вторая проверка нужна из-за squash-merge: он не делает коммит ветки предком `main`,
 * поэтому после мержа PR git показывает ветку как «не влитую», и работа может продолжиться
 * на влитом коде. Push такой ветки останавливается с командой очистки, а состояние задачи
 * проверяется фактом (`gh pr list --head <ветка>`).
 *
 * Третья проверка — база ветки (#189): конфликт с `origin/main` отклоняет push. GitHub не запускает
 * проверки у PR с конфликтами, поэтому такой PR приезжает молчаливым («no checks reported»), и
 * выясняется это уже на странице конфликтов. Отставание без конфликта — только предупреждение.
 *
 * GitHub недоступен (`gh` не установлен, нет сети или авторизации) — только предупреждение:
 * проверка защищённых веток работает офлайн и остаётся единственным жёстким гейтом.
 *
 * Обойти: `git push --no-verify` — только осознанно (`docs/workflow.md`: push в `main` запрещён).
 * Ветки читаются из stdin, поэтому проверка не зависит от текущего HEAD: `git push origin
 * main:<другая>` тоже блокируется по remote-ref.
 *
 * Shebang нужен: файл запускается напрямую из хука.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { DEFAULT_BASE, baseProblem } from './base-guard.mjs';
import {
  mergedBranchBlockReason,
  mergedPull,
  pushedBranchRefs,
  pushedBranches,
} from './branch-guard.mjs';
import { listPullsForBranch } from './gh-cli.mjs';
import { parsePushRefs, pushBlockReason } from './git-guard.mjs';

/**
 * Читает stdin целиком (git закрывает поток после списка ref).
 * @returns {string}
 */
function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Причины отказа по смерженным веткам: пусто, если PR открыт, не создан или GitHub не ответил.
 * @param {string[]} branches
 * @returns {string[]}
 */
function mergedBranchReasons(branches) {
  /** @type {string[]} */
  const reasons = [];

  for (const branch of branches) {
    const lookup = listPullsForBranch(branch);
    if (!lookup.ok) {
      process.stderr.write(
        `pre-push: состояние PR для «${branch}» не проверено (${lookup.reason}) — проверьте gh pr list --head ${branch}\n`,
      );
      continue;
    }

    const pull = mergedPull(/** @type {any} */ (lookup.pulls), branch);
    if (pull === null) continue;
    const reason = mergedBranchBlockReason(branch, pull);
    if (reason !== null) reasons.push(reason);
  }

  return reasons;
}

/**
 * Запуск git с перехватом вывода: код выхода и stdout нужны вместе, чтобы отличить конфликт
 * (`merge-tree` печатает oid дерева) от фатальной ошибки (stdout пустой).
 * @param {string[]} args аргументы
 * @returns {{status: number | null, stdout: string}} код и stdout
 */
function gitRun(args) {
  try {
    const stdout = execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, stdout };
  } catch (error) {
    const failed = /** @type {{status?: unknown, stdout?: unknown}} */ (error);
    return {
      status: typeof failed.status === 'number' ? failed.status : null,
      stdout: typeof failed.stdout === 'string' ? failed.stdout : '',
    };
  }
}

/**
 * Предупреждения и отказы по базе ветки: конфликт с `origin/main` отклоняет push.
 *
 * Сеть не нужна: сверяемся с локальным `refs/remotes/origin/main`. Если его нет (клон без
 * фетча, офлайн) — молчим: отказ по незнанию хуже, чем отсутствие проверки.
 * @param {{ branch: string, sha: string }[]} branches пушимые ветки
 * @returns {{ reasons: string[], warnings: string[] }} отказы и предупреждения
 */
function baseReasons(branches) {
  /** @type {string[]} */
  const reasons = [];
  /** @type {string[]} */
  const warnings = [];

  if (gitRun(['rev-parse', '--verify', '--quiet', `${DEFAULT_BASE}^{commit}`]).status !== 0) {
    return { reasons, warnings };
  }

  for (const { branch, sha } of branches) {
    // Неизвестный объект (не коммит, чужой sha) — не повод ни блокировать, ни предупреждать:
    // сверять нечего, а отказ по догадке хуже тишины.
    if (gitRun(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]).status !== 0) continue;
    if (gitRun(['merge-base', '--is-ancestor', DEFAULT_BASE, sha]).status === 0) continue;

    // `merge-tree --write-tree` пишет дерево в объектную базу и выходит кодом 1 при конфликте.
    // Тот же код 1 бывает у фатальной ошибки (невалидный объект) — там stdout пустой, поэтому
    // конфликт определяем по непустому stdout: он начинается с oid дерева.
    const merge = gitRun(['merge-tree', '--write-tree', sha, DEFAULT_BASE]);
    const conflicts = merge.status === 1 && merge.stdout.trim() !== '';

    const problem = baseProblem({ branch, base: DEFAULT_BASE, behind: true, conflicts });
    if (problem === null) continue;

    if (problem.level === 'block') reasons.push(problem.message);
    else warnings.push(problem.message);
  }

  return { reasons, warnings };
}

const refs = parsePushRefs(readStdin());
const branches = pushedBranchRefs(refs);
const base = baseReasons(branches);
for (const warning of base.warnings) process.stderr.write(`${warning}\n`);

const reasons = [
  pushBlockReason(refs),
  ...mergedBranchReasons(pushedBranches(refs)),
  ...base.reasons,
].filter((reason) => reason !== null);

if (reasons.length > 0) {
  for (const reason of reasons) process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
}
