import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  addedLines,
  addedLinesByFile,
  baseSha,
  changedFiles,
  changedFilesWithStatus,
  diffFromBase,
  intentToAddUntracked,
} from './git.mjs';

// Глобальный и системный конфиг git в тестах не нужен: он мог бы включить подпись коммитов,
// hooksPath или другую базовую ветку. Наследуется дочерними процессами модуля.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';

/**
 * Запускает git в тестовом репозитории.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Временный git-репозиторий с одним коммитом в `main`.
 * Идентичность фиктивная: настоящие имя и адрес в тестах не нужны (§4, ПДн).
 * @param {import('node:test').TestContext} t
 * @returns {{ dir: string, sha: string }}
 */
function makeRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir, encoding: 'utf8' });
  git(['config', 'user.name', 'Test User'], dir);
  git(['config', 'user.email', 'test@example.invalid'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);

  writeFileSync(join(dir, 'tracked.txt'), 'base\n');
  git(['add', 'tracked.txt'], dir);
  git(['commit', '-m', 'base'], dir);

  return { dir, sha: baseSha({ branch: 'main', cwd: dir }) };
}

/** Образец диффа: добавления в существующий файл и в новый файл. */
const SAMPLE_DIFF = [
  'diff --git a/notes.txt b/notes.txt',
  'index 1111111..2222222 100644',
  '--- a/notes.txt',
  '+++ b/notes.txt',
  '@@ -1,2 +1,3 @@',
  ' first',
  '-removed',
  '+second',
  ' third',
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1 @@',
  '+brand new',
].join('\n');

/**
 * Строка, содержимое которой само начинается с `++`: образец собирается из частей, чтобы
 * цельная секретоподобная строка не оказалась в добавленном коде — иначе обязательный
 * гейт `secrets_scan` (§5.5) нашёл бы её в самом тесте.
 */
const DOUBLE_PLUS_LINE = ['+', 'AKIA', '1234567890123456'].join('');

/** Самый неудобный для построчного фильтра случай: содержимое строки само начинается с `++`. */
const TRICKY_DIFF = [
  'diff --git a/keys.txt b/keys.txt',
  'index 1111111..2222222 100644',
  '--- a/keys.txt',
  '+++ b/keys.txt',
  '@@ -1,2 +1,3 @@',
  ' context',
  '+plain line',
  `+${DOUBLE_PLUS_LINE}`,
  '-removed line',
].join('\n');

/** Дифф нового файла: заголовок `+++ b/...` не должен попасть в добавления. */
const NEW_FILE_DIFF = [
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1,2 @@',
  '+first',
  '+second',
].join('\n');

/** Дифф без завершающего перевода строки: маркеры `\ No newline at end of file` не содержание. */
const NO_NEWLINE_DIFF = [
  'diff --git a/nonl.txt b/nonl.txt',
  'index 1111111..2222222 100644',
  '--- a/nonl.txt',
  '+++ b/nonl.txt',
  '@@ -1 +1 @@',
  '-old',
  '\\ No newline at end of file',
  '+new',
  '\\ No newline at end of file',
].join('\n');

/** Удаление файла и изменение второго: после ханка заголовки следующего файла не добавления. */
const DELETE_THEN_HUNK_DIFF = [
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  'index 4444444..0000000',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-gone',
  'diff --git a/kept.txt b/kept.txt',
  'index 5555555..6666666 100644',
  '--- a/kept.txt',
  '+++ b/kept.txt',
  '@@ -1 +1 @@',
  '-before',
  '+after',
].join('\n');

/** Два ханка одного файла: номера строк во втором ханке берутся из его заголовка. */
const MULTI_HUNK_DIFF = [
  'diff --git a/src/app.mjs b/src/app.mjs',
  'index 1111111..2222222 100644',
  '--- a/src/app.mjs',
  '+++ b/src/app.mjs',
  '@@ -1,2 +1,3 @@',
  ' first',
  '+added after first',
  ' second',
  '@@ -10,2 +11,2 @@',
  '-old line',
  '+new line',
  ' tail',
].join('\n');

describe('git', () => {
  test('без intent-to-add новый файл в диффе не виден, после — виден целиком', (t) => {
    const { dir, sha } = makeRepo(t);
    appendFileSync(join(dir, 'tracked.txt'), 'changed\n');
    writeFileSync(join(dir, 'new.txt'), 'new content\n');

    const before = diffFromBase(sha, { cwd: dir });
    assert.match(before, /tracked\.txt/);
    assert.doesNotMatch(before, /new\.txt/);

    assert.deepEqual(intentToAddUntracked({ cwd: dir }), ['new.txt']);

    const after = diffFromBase(sha, { cwd: dir });
    assert.match(after, /new\.txt/);
    assert.match(after, /\+new content/);
    assert.match(after, /\+changed/);
  });

  test('без untracked-файлов intentToAddUntracked ничего не делает', (t) => {
    const { dir } = makeRepo(t);
    appendFileSync(join(dir, 'tracked.txt'), 'changed\n');

    assert.deepEqual(intentToAddUntracked({ cwd: dir }), []);
  });

  test('заранее staged правки не теряются: дифф один и тот же при двух прогонах', (t) => {
    const { dir } = makeRepo(t);
    writeFileSync(join(dir, 'other.txt'), 'other base\n');
    git(['add', 'other.txt'], dir);
    git(['commit', '-m', 'второй файл в базе'], dir);
    const sha = baseSha({ branch: 'main', cwd: dir });

    // Три состояния индекса сразу: staged правка, unstaged правка и новый файл.
    appendFileSync(join(dir, 'tracked.txt'), 'staged line\n');
    git(['add', 'tracked.txt'], dir);
    appendFileSync(join(dir, 'other.txt'), 'unstaged line\n');
    writeFileSync(join(dir, 'new.txt'), 'new file\n');

    assert.deepEqual(intentToAddUntracked({ cwd: dir }), ['new.txt']);
    const first = diffFromBase(sha, { cwd: dir });

    assert.deepEqual(intentToAddUntracked({ cwd: dir }), [], 'повторный прогон — no-op');
    assert.equal(diffFromBase(sha, { cwd: dir }), first, 'дифф от базы не зависит от повторов');

    assert.match(first, /\+staged line/u, 'staged-правка в диффе');
    assert.match(first, /\+unstaged line/u, 'unstaged-правка в диффе');
    assert.match(first, /\+new file/u, 'новый файл в диффе');
  });

  test('intentToAddUntracked не трогает уже staged записи индекса', (t) => {
    const { dir } = makeRepo(t);
    appendFileSync(join(dir, 'tracked.txt'), 'staged line\n');
    git(['add', 'tracked.txt'], dir);
    writeFileSync(join(dir, 'new.txt'), 'new content\n');

    const entryBefore = git(['ls-files', '-s', 'tracked.txt'], dir);
    const stagedBefore = git(['diff', '--cached', '--', 'tracked.txt'], dir);
    assert.equal(git(['diff', '--cached', '--name-only'], dir).trim(), 'tracked.txt');

    intentToAddUntracked({ cwd: dir });

    assert.equal(git(['ls-files', '-s', 'tracked.txt'], dir), entryBefore, 'запись индекса та же');
    assert.deepEqual(
      git(['ls-files'], dir).trim().split('\n'),
      ['new.txt', 'tracked.txt'],
      'в индекс добавился только новый путь',
    );
    assert.equal(
      git(['diff', '--cached', '--', 'tracked.txt'], dir),
      stagedBefore,
      'staged-содержимое не перезаписано',
    );
    assert.equal(
      git(['diff', '--cached', '--name-only'], dir).trim(),
      'tracked.txt',
      'intent-to-add не выдаёт себя за staged-содержимое',
    );
    assert.match(git(['diff', '--cached', '--', 'tracked.txt'], dir), /\+staged line/u);
  });

  test('git reset между прогонами: цикл продолжается, intent-to-add ставится заново', (t) => {
    const { dir, sha } = makeRepo(t);
    appendFileSync(join(dir, 'tracked.txt'), 'changed\n');
    writeFileSync(join(dir, 'new.txt'), 'new content\n');

    intentToAddUntracked({ cwd: dir });
    const first = diffFromBase(sha, { cwd: dir });
    assert.match(first, /\+new content/u);

    // Пользователь снял индекс руками. Новые файлы остались на диске — иначе `reset` терял бы работу.
    git(['reset', '-q'], dir);
    assert.equal(git(['diff', '--cached', '--name-only'], dir), '', 'индекс пуст');
    assert.doesNotMatch(
      diffFromBase(sha, { cwd: dir }),
      /new\.txt/u,
      'без intent-to-add новый файл из диффа выпадает — поэтому шаг повторяется на каждом этапе',
    );

    assert.deepEqual(intentToAddUntracked({ cwd: dir }), ['new.txt'], 'шаг восстанавливается');
    assert.equal(diffFromBase(sha, { cwd: dir }), first, 'цикл продолжается с тем же диффом');
  });

  test('changedFiles перечисляет изменённые файлы от базы', (t) => {
    const { dir, sha } = makeRepo(t);
    appendFileSync(join(dir, 'tracked.txt'), 'changed\n');
    writeFileSync(join(dir, 'new.txt'), 'new content\n');
    intentToAddUntracked({ cwd: dir });

    assert.deepEqual(changedFiles(sha, { cwd: dir }), ['new.txt', 'tracked.txt']);
  });

  test('changedFilesWithStatus различает добавление, правку и удаление', (t) => {
    const { dir } = makeRepo(t);
    // Удаляемый файл должен быть в базе: иначе дифф от базы его просто не увидит.
    writeFileSync(join(dir, 'gone.txt'), 'soon deleted\n');
    git(['add', 'gone.txt'], dir);
    git(['commit', '-m', 'файл под удаление'], dir);
    const sha = baseSha({ branch: 'main', cwd: dir });

    appendFileSync(join(dir, 'tracked.txt'), 'changed\n');
    writeFileSync(join(dir, 'new.txt'), 'new content\n');
    rmSync(join(dir, 'gone.txt'));
    intentToAddUntracked({ cwd: dir });

    assert.deepEqual(changedFilesWithStatus(sha, { cwd: dir }), [
      { path: 'gone.txt', status: 'deleted' },
      { path: 'new.txt', status: 'added' },
      { path: 'tracked.txt', status: 'modified' },
    ]);
  });

  test('changedFilesWithStatus не кавычит не-ASCII имена (`-z`)', (t) => {
    const { dir, sha } = makeRepo(t);
    writeFileSync(join(dir, 'тест.txt'), 'данные\n');
    intentToAddUntracked({ cwd: dir });

    assert.deepEqual(changedFilesWithStatus(sha, { cwd: dir }), [
      { path: 'тест.txt', status: 'added' },
    ]);
  });

  test('changedFilesWithStatus видит переименование как удаление и добавление', (t) => {
    const { dir } = makeRepo(t);
    writeFileSync(join(dir, 'before.txt'), 'content\n');
    git(['add', 'before.txt'], dir);
    git(['commit', '-m', 'файл до переименования'], dir);
    const sha = baseSha({ branch: 'main', cwd: dir });
    git(['mv', 'before.txt', 'after.txt'], dir);

    assert.deepEqual(changedFilesWithStatus(sha, { cwd: dir }), [
      { path: 'after.txt', status: 'added' },
      { path: 'before.txt', status: 'deleted' },
    ]);
  });

  test('baseSha возвращает sha коммита базовой ветки', (t) => {
    const { dir, sha } = makeRepo(t);

    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(sha, git(['rev-parse', 'HEAD'], dir).trim());
  });

  test('addedLines оставляет только добавленные строки без префикса', () => {
    assert.deepEqual(addedLines(SAMPLE_DIFF), ['second', 'brand new']);
  });

  test('addedLines не путает добавленную строку, начинающуюся с `++`, с заголовком', () => {
    assert.deepEqual(addedLines(TRICKY_DIFF), ['plain line', DOUBLE_PLUS_LINE]);
    assert.ok(addedLines(TRICKY_DIFF).every((line) => !line.startsWith('++ b/')));
  });

  test('addedLines читает дифф нового файла и не возвращает заголовок `+++ b/...`', () => {
    assert.deepEqual(addedLines(NEW_FILE_DIFF), ['first', 'second']);
  });

  test('addedLines игнорирует маркеры `\\ No newline at end of file`', () => {
    assert.deepEqual(addedLines(NO_NEWLINE_DIFF), ['new']);
  });

  test('addedLines пропускает удаления и заголовки следующего файла', () => {
    assert.deepEqual(addedLines(DELETE_THEN_HUNK_DIFF), ['after']);
  });

  test('addedLinesByFile возвращает файлы с номерами строк в новой версии', () => {
    assert.deepEqual(addedLinesByFile(SAMPLE_DIFF), [
      { file: 'notes.txt', lines: [{ line: 2, text: 'second' }] },
      { file: 'new.txt', lines: [{ line: 1, text: 'brand new' }] },
    ]);
  });

  test('addedLinesByFile не принимает строку `+++…` внутри ханка за заголовок файла', () => {
    assert.deepEqual(addedLinesByFile(TRICKY_DIFF), [
      {
        file: 'keys.txt',
        lines: [
          { line: 2, text: 'plain line' },
          { line: 3, text: DOUBLE_PLUS_LINE },
        ],
      },
    ]);
  });

  test('addedLinesByFile нумерует строки нового файла с единицы', () => {
    assert.deepEqual(addedLinesByFile(NEW_FILE_DIFF), [
      {
        file: 'new.txt',
        lines: [
          { line: 1, text: 'first' },
          { line: 2, text: 'second' },
        ],
      },
    ]);
  });

  test('addedLinesByFile не двигает номер строки на маркере `\\ No newline at end of file`', () => {
    assert.deepEqual(addedLinesByFile(NO_NEWLINE_DIFF), [
      { file: 'nonl.txt', lines: [{ line: 1, text: 'new' }] },
    ]);
  });

  test('addedLinesByFile пропускает файл без добавлений и нумерует второй файл отдельно', () => {
    assert.deepEqual(addedLinesByFile(DELETE_THEN_HUNK_DIFF), [
      { file: 'kept.txt', lines: [{ line: 1, text: 'after' }] },
    ]);
  });

  test('addedLinesByFile берёт номер строки из заголовка каждого ханка', () => {
    assert.deepEqual(addedLinesByFile(MULTI_HUNK_DIFF), [
      {
        file: 'src/app.mjs',
        lines: [
          { line: 2, text: 'added after first' },
          { line: 11, text: 'new line' },
        ],
      },
    ]);
  });

  test('addedLinesByFile на пустом диффе возвращает пустой список', () => {
    assert.deepEqual(addedLinesByFile(''), []);
  });

  test('addedLinesByFile разбирает настоящий дифф git и нумерует строки по новому файлу', (t) => {
    const { dir, sha } = makeRepo(t);
    writeFileSync(join(dir, 'tracked.txt'), 'base\nadded\n');
    writeFileSync(join(dir, 'new.txt'), 'brand new\n');
    intentToAddUntracked({ cwd: dir });

    assert.deepEqual(addedLinesByFile(diffFromBase(sha, { cwd: dir })), [
      { file: 'new.txt', lines: [{ line: 1, text: 'brand new' }] },
      { file: 'tracked.txt', lines: [{ line: 2, text: 'added' }] },
    ]);
  });

  test('diffFromBase отклоняет небезопасную базу и не даёт git принять её за опцию', (t) => {
    const { dir } = makeRepo(t);
    const victim = join(dir, 'victim.txt');
    const unsafe = [
      '--output=/tmp/x',
      `--output=${victim}`,
      '-x',
      'main main',
      'main\nx',
      'main\t..',
      '../main',
      'main..x',
      'main//x',
      '/main',
      'main/',
      '.git',
      '',
    ];

    for (const base of unsafe) {
      assert.throws(
        () => diffFromBase(base, { cwd: dir }),
        /base:/,
        `база должна отклоняться: ${base}`,
      );
      assert.throws(
        () => changedFiles(base, { cwd: dir }),
        /base:/,
        `база должна отклоняться: ${base}`,
      );
    }
    assert.throws(() => baseSha({ branch: '--upload-pack=touch /tmp/x', cwd: dir }), /branch:/);
    assert.throws(() => baseSha({ branch: '-x', cwd: dir }), /branch:/);

    assert.equal(existsSync(victim), false, 'файл из --output не должен создаваться');
    assert.equal(existsSync('/tmp/x'), false, 'файл из --output=/tmp/x не должен создаваться');
  });

  test('diffFromBase отклоняет опции git без явного cwd (значение проверяется до вызова)', () => {
    assert.throws(() => diffFromBase('--output=/tmp/x'), /base:/);
    assert.throws(() => diffFromBase('-x'), /base:/);
    assert.throws(() => diffFromBase('main main'), /base:/);
    assert.throws(() => diffFromBase('main\nx'), /base:/);
    assert.equal(existsSync('/tmp/x'), false, 'файл из --output=/tmp/x не должен создаваться');
  });

  test('безопасные базы: sha и имя ссылки работают', (t) => {
    const { dir, sha } = makeRepo(t);
    appendFileSync(join(dir, 'tracked.txt'), 'changed\n');

    assert.equal(diffFromBase(sha, { cwd: dir }), diffFromBase('main', { cwd: dir }));
    assert.deepEqual(changedFiles('main', { cwd: dir }), ['tracked.txt']);
    assert.equal(baseSha({ branch: 'main', cwd: dir }), sha);
  });
});
