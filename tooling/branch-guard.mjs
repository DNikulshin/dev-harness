/**
 * Гейт «ветка уже смержена в PR».
 *
 * Повод: squash-merge не делает коммит ветки предком `main`, поэтому после мержа PR
 * `git branch --contains` и `git status` выглядят как незавершённая работа — легко продолжить
 * на влитой ветке и доложить статус догадкой. Состояние задачи проверяется фактом
 * (`gh issue view`, `gh pr list --head <ветка>`), а push такой ветки отклоняется механизмом.
 *
 * Модуль чистый: данные GitHub и git приходят снаружи, сеть и процессы здесь не вызываются.
 * Shebang не нужен: подключается из `tooling/pre-push.mjs` и `tooling/git-hygiene.mjs`.
 */

/**
 * Pull request в том виде, в каком он приходит из `gh pr list --json …`.
 * @typedef {object} Pull
 * @property {number} [number]
 * @property {string} [state]
 * @property {string} [headRefName]
 * @property {string} [url]
 * @property {string} [mergedAt]
 */

/** Состояния pull request, которые приходят из `gh pr list --json state`. */
const MERGED = 'MERGED';

/** SHA удаления ветки: git присылает нули в `pre-push` вместо коммита. */
const ZERO_SHA = /^0+$/;

/**
 * Брался ли ref из `pre-push` в реальный push ветки (не удаление и не тег).
 * @param {{ localRef: string, localSha: string }} ref
 * @returns {boolean}
 */
function isPushedBranch(ref) {
  return (
    typeof ref.localRef === 'string' &&
    ref.localRef.startsWith('refs/heads/') &&
    typeof ref.localSha === 'string' &&
    ref.localSha.length > 0 &&
    !ZERO_SHA.test(ref.localSha)
  );
}

/**
 * Имена веток из stdin `pre-push`, которые git собирается запушить.
 * Удаление (`--delete`) и теги сюда не попадают: у них нет коммита ветки.
 * @param {{ localRef: string, localSha: string }[]} refs
 * @returns {string[]}
 */
export function pushedBranches(refs) {
  if (!Array.isArray(refs)) return [];

  const branches = refs
    .filter(isPushedBranch)
    .map((ref) => ref.localRef.slice('refs/heads/'.length));
  return [...new Set(branches)];
}

/**
 * Смерженный pull request этой ветки или `null`.
 * @param {readonly Pull[]} pulls
 * @param {string} branch
 * @returns {Pull | null}
 */
export function mergedPull(pulls, branch) {
  if (!Array.isArray(pulls) || typeof branch !== 'string' || branch === '') return null;

  const head = branch.trim();
  const found = pulls.find(
    (pull) =>
      pull.state === MERGED && (pull.headRefName === undefined || pull.headRefName === head),
  );
  return found ?? null;
}

/**
 * Сообщение об отказе push смерженной ветки или `null`, если push разрешён.
 * @param {string} branch
 * @param {Pull | null} pull
 * @returns {string|null}
 */
export function mergedBranchBlockReason(branch, pull) {
  const pullInfo = pull === null || typeof pull !== 'object' ? null : pull;
  if (pullInfo === null || typeof branch !== 'string' || branch.trim() === '') return null;

  const label = pullInfo.number === undefined ? 'PR' : `PR #${pullInfo.number}`;
  const name = branch.trim();

  return [
    `pre-push: ветка «${name}» уже смержена (${label}), push запрещён (docs/workflow.md).`,
    'Работа влита в main — новая задача начинается с новой ветки:',
    '  git checkout main && git pull && git branch -D ' + name,
    '  git checkout -b chore/<номер-issue>-<краткое-имя>',
    'Список таких веток: pnpm git:hygiene.',
    'Осознанное исключение (правка уже влитого PR): git push --no-verify.',
  ].join('\n');
}

/**
 * Локальные ветки, чьи PR смержены: их пора удалить, иначе работа продолжится на влитом коде.
 * @param {readonly string[]} localBranches ветки из `git for-each-ref refs/heads`
 * @param {readonly Pull[] | null} pulls
 * @returns {{ branch: string, number?: number, mergedAt?: string }[]}
 */
export function staleMergedBranches(localBranches, pulls) {
  if (!Array.isArray(localBranches) || !Array.isArray(pulls)) return [];

  /** @type {Map<string, Pull>} */
  const mergedByHead = new Map();
  for (const pull of pulls) {
    if (pull?.state !== MERGED || typeof pull.headRefName !== 'string') continue;
    if (!mergedByHead.has(pull.headRefName)) mergedByHead.set(pull.headRefName, pull);
  }

  /** @type {{ branch: string, number?: number, mergedAt?: string }[]} */
  const rows = [];
  for (const branch of [...new Set(localBranches)]) {
    const pull = mergedByHead.get(branch);
    if (pull === undefined) continue;
    rows.push({ branch, number: pull.number, mergedAt: pull.mergedAt });
  }
  return rows;
}
