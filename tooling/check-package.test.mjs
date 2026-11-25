/**
 * Тесты контракта архива и релизной проверки (issue #72).
 *
 * Проверка, которая не краснеет на сломанном архиве, ничего не доказывает: релизный workflow
 * запускает её как гейт, и если правила терпимы к пропущенному `LICENSE` или к расхождению тега с
 * `package.json`, публикация пройдёт. Поэтому находки проверяются здесь, на синтетических списках
 * файлов, а не только на настоящем архиве (`scripts/package-consumer.test.mjs`).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_ENTRIES,
  archiveProblems,
  packageProblems,
  promisedPaths,
} from '../scripts/lib/package-contract.mjs';
import { checkArchive, parseArgs } from './check-package.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Полный архив: все обязательные записи контракта. */
const FULL = Object.freeze([...REQUIRED_ENTRIES]);

/**
 * Минимальный разобранный `package.json` для проверки обещаний.
 * @param {{ bin?: unknown, exports?: unknown, version?: string, name?: string }} [overrides]
 * @returns {Record<string, any>}
 */
function pkg(overrides = {}) {
  return {
    name: '@dnikulshin/harness',
    version: '0.1.0',
    bin: { harness: './scripts/harness.mjs' },
    exports: {
      './scripts/harness': { types: './types/harness.d.mts', default: './scripts/harness.mjs' },
    },
    ...overrides,
  };
}

describe('контракт архива', () => {
  test('полный архив — находок нет', () => {
    assert.deepEqual(archiveProblems(FULL), []);
  });

  test('пропущенная обязательная запись — находка с именем файла', () => {
    const problems = archiveProblems(FULL.filter((path) => path !== 'LICENSE'));

    assert.equal(problems.length, 1);
    assert.match(problems.join('\n'), /нет LICENSE/u);
  });

  test('инфраструктура репозитория в архиве — находка с префиксом', () => {
    const problems = archiveProblems([...FULL, 'tooling/rag-sync.mjs', '.github/workflows/ci.yml']);

    assert.equal(problems.length, 2);
    assert.ok(problems.some((problem) => problem.includes('tooling/')));
    assert.ok(problems.some((problem) => problem.includes('.github/')));
  });
});

describe('обещания package.json', () => {
  test('promisedPaths собирает bin и exports без шаблонных ключей', () => {
    assert.deepEqual(
      promisedPaths(
        pkg({
          bin: { harness: './scripts/harness.mjs', 'harness-init': './scripts/harness-init.mjs' },
          exports: {
            './templates/*': './templates/*',
            './package.json': './package.json',
            './scripts/harness': {
              types: './types/harness.d.mts',
              default: './scripts/harness.mjs',
            },
          },
        }),
      ),
      ['package.json', 'scripts/harness-init.mjs', 'scripts/harness.mjs', 'types/harness.d.mts'],
    );
  });

  test('обещанный, но отсутствующий файл — находка', () => {
    const problems = packageProblems({
      pkg: pkg({ bin: { harness: './scripts/harness.mjs' } }),
      entries: FULL,
      expected: { name: '@dnikulshin/harness', version: '0.1.0' },
    });

    assert.deepEqual(problems, [], 'все обещанные файлы есть в контракте');
  });

  test('расхождение версии с тегом — находка', () => {
    const problems = packageProblems({
      pkg: pkg(),
      entries: FULL,
      expected: { version: '0.2.0' },
    });

    assert.equal(problems.length, 1);
    assert.match(problems.join('\n'), /в архиве версия 0\.1\.0, ожидалось 0\.2\.0/u);
  });

  test('расхождение имени пакета — находка', () => {
    const problems = packageProblems({
      pkg: pkg({ name: 'other-package' }),
      entries: FULL,
      expected: { name: '@dnikulshin/harness' },
    });

    assert.match(problems.join('\n'), /в архиве имя other-package/u);
  });

  test('пропавший файл bin и отсутствие bin — находки', () => {
    const missing = packageProblems({
      pkg: pkg({ bin: { harness: './scripts/nope.mjs' } }),
      entries: FULL,
    });
    assert.match(missing.join('\n'), /обещает scripts\/nope\.mjs/u);

    const none = packageProblems({ pkg: pkg({ bin: undefined }), entries: FULL });
    assert.match(none.join('\n'), /без bin/u);
  });
});

describe('checkArchive и CLI', () => {
  /**
   * Временный архив-пустышка: проверяются находки, а не tar-формат.
   * @param {import('node:test').TestContext} t
   * @returns {string}
   */
  function emptyArchive(t) {
    const dir = mkdtempSync(join(tmpdir(), 'check-package-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'missing.tgz');
    writeFileSync(file, '');
    return file;
  }

  test('несуществующий архив — ошибка, а не пустой список находок', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'check-package-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    assert.throws(() => checkArchive({ file: join(dir, 'нет.tgz') }), /архив не найден/u);
  });

  test('нечитаемый архив — ошибка чтения', (t) => {
    const file = emptyArchive(t);

    assert.throws(() => checkArchive({ file }));
  });

  test('parseArgs: архив обязателен, --tag отдельным флагом', () => {
    assert.deepEqual(parseArgs(['pack.tgz', '--tag', 'v0.1.0']).tag, 'v0.1.0');
    assert.equal(parseArgs(['pack.tgz']).tag, null);
    assert.throws(() => parseArgs([]), /использование: check-package/u);
    assert.throws(() => parseArgs(['a.tgz', '--tag']), /--tag: ожидается vX\.Y\.Z/u);
    assert.throws(() => parseArgs(['a.tgz', 'b.tgz']), /лишний аргумент/u);
  });
});

describe('release.yml', () => {
  const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  // Комментарии в workflow обсуждают команды — сравниваем только исполняемые строки.
  const COMMANDS = WORKFLOW.split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

  test('npm publish получает ./dist/: без префикса npm уходит в GitHub-шорткат', () => {
    const publish = COMMANDS.split('\n').filter((line) => line.includes('npm publish'));

    assert.equal(publish.length, 1, 'ожидается ровно одна команда npm publish');
    assert.match(
      publish[0] ?? '',
      /npm publish \.\/dist\/\*\.tgz/u,
      'путь без ./ npm разбирает как owner/repo и делает git ls-remote (issue #157)',
    );
  });

  test('проверка состава стоит до публикации и сверяет версию с тегом', () => {
    const checkIndex = COMMANDS.indexOf('tooling/check-package.mjs');
    const publishIndex = COMMANDS.indexOf('npm publish');

    assert.ok(checkIndex > 0, 'в workflow нет шага проверки состава');
    assert.ok(checkIndex < publishIndex, 'проверка состава должна идти до публикации');
    assert.match(COMMANDS, /check-package\.mjs dist\/\*\.tgz --tag "\$GITHUB_REF_NAME"/u);
  });

  test('публикация с provenance: id-token и флаг на месте', () => {
    assert.match(COMMANDS, /id-token: write/u);
    assert.match(COMMANDS, /--provenance/u);
    assert.match(COMMANDS, /--access public/u);
  });

  test('пустой NPM_TOKEN ловится до работы, а не на публикации', () => {
    const guardIndex = COMMANDS.indexOf('NODE_AUTH_TOKEN');
    const checkIndex = COMMANDS.indexOf('pnpm check');
    const publishIndex = COMMANDS.indexOf('npm publish');

    assert.ok(guardIndex > 0, 'в workflow нет шага проверки NPM_TOKEN (issue #161)');
    assert.match(COMMANDS, /secrets\.NPM_TOKEN/u, 'проверка читает секрет из secrets.NPM_TOKEN');
    assert.match(COMMANDS, /Секрет NPM_TOKEN не задан/u, 'отказ называет причину словами');
    assert.ok(
      guardIndex < checkIndex && guardIndex < publishIndex,
      'проверка токена должна стоять до тестов и до публикации',
    );
  });

  test('опубликовано — это версия в реестре, а не вывод npm publish', () => {
    const publishIndex = COMMANDS.indexOf('npm publish');
    const verifyIndex = COMMANDS.indexOf('npm view');

    assert.ok(verifyIndex > 0, 'в workflow нет проверки версии в реестре (issue #205)');
    assert.ok(publishIndex < verifyIndex, 'проверять реестр имеет смысл только после публикации');
    assert.match(
      COMMANDS,
      /version="\$\{GITHUB_REF_NAME#v\}"/u,
      'проверяется версия из тега, а не константа в workflow',
    );
    assert.match(COMMANDS, /seq 1 10/u, 'реестр отдаёт версию не мгновенно — нужны ретраи');
    assert.match(
      COMMANDS,
      /Staged\/pending/u,
      'отказ говорит, куда смотреть: staged publish ждёт подтверждения',
    );
  });
});
