/**
 * Гейт «база ветки»: push ветки, которая конфликтует с `origin/main`.
 *
 * Повод: GitHub **не запускает проверки** для PR с конфликтами. PR приезжает молчаливым — `gh pr
 * checks` отвечает «no checks reported», и это читается как «CI ещё идёт». Так дважды за сессию
 * (#182, #188) ветка создавалась от устаревшего локального `main`, и причина находилась только на
 * странице конфликтов.
 *
 * Что проверяем: содержит ли ветка базу, и если нет — даёт ли слияние базы конфликт. Отставание
 * само по себе не ошибка (проверки запустятся, конфликта нет) — это предупреждение; ошибка — именно
 * конфликт, потому что он превращает PR в молчаливый.
 *
 * Модуль чистый: `behind` и `conflicts` приходят снаружи, git здесь не вызывается.
 * Shebang не нужен: подключается из `tooling/pre-push.mjs`.
 */

/** База сверки по умолчанию: удалённая основная ветка. */
export const DEFAULT_BASE = 'origin/main';

/**
 * Итог сверки базы.
 * @typedef {object} BaseProblem
 * @property {'block' | 'warn'} level `block` — push отклоняется, `warn` — только сообщение
 * @property {string} message текст для stderr
 */

/**
 * Что сказать про ветку и базу, или `null`, если говорить нечего.
 *
 * `null` возвращается в трёх случаях: ветка содержит базу (свежая), базы нет в репозитории
 * (офлайн-клон, ещё не фетчили) и «не знаем» вместо «конфликт» — отказ по догадке хуже тишины.
 * @param {{branch?: unknown, base?: unknown, behind?: unknown, conflicts?: unknown}} [params] ветка,
 *   база и результат сверки
 * @returns {BaseProblem | null} что печатать
 */
export function baseProblem({ branch, base = DEFAULT_BASE, behind, conflicts } = {}) {
  const name = typeof branch === 'string' ? branch.trim() : '';
  const baseRef = typeof base === 'string' && base.trim() !== '' ? base.trim() : DEFAULT_BASE;
  if (name === '' || behind !== true) return null;

  const rebase = `  git fetch origin && git rebase ${baseRef}`;

  if (conflicts === true) {
    return {
      level: 'block',
      message: [
        `pre-push: ветка «${name}» конфликтует с ${baseRef} — GitHub не запустит проверки, и PR`,
        'приедет молчаливым (no checks reported). Перебазируйте ветку и повторите push:',
        rebase,
        'Конфликты: правьте файлы, затем `git add <файл> && git rebase --continue`.',
      ].join('\n'),
    };
  }

  // Отставание без данных о конфликте — не «всё хорошо», а «не знаем»: молчим.
  if (conflicts !== false) return null;

  return {
    level: 'warn',
    message: [
      `pre-push: ветка «${name}» отстаёт от ${baseRef} (конфликта нет) — проверки запустятся, но перед`,
      'мержем ветку стоит обновить, чтобы зелёный CI относился к актуальной базе:',
      rebase,
    ].join('\n'),
  };
}
