/**
 * Два README — одна правда (issue #202).
 *
 * `README.md` — английский (его видит страница пакета на npm), `README.ru.md` — русский. Два текста
 * расходятся молча: правку внесли в один, второй отстал, и заметить это можно только прочитав оба.
 * Здесь сравниваются только те факты, которые читатель использует как инструкцию, — имена команд
 * (`harness-*`) и ссылки на документы репозитория: остальное (объяснения, тон, примеры) может
 * отличаться, потому что это перевод, а не копия.
 *
 * Тест читает файлы репозитория, поэтому в установленном пакете он пропускается (`REPO_ONLY`).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { REPO_ONLY } from './lib/testsupport.mjs';

/** Корень репозитория: родитель каталога `scripts/`. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string} name имя файла в корне репозитория
 * @returns {string} содержимое
 */
function readme(name) {
  return readFileSync(join(ROOT, name), 'utf8');
}

/** @type {{ en: string, ru: string }} */
const TEXT = { en: readme('README.md'), ru: readme('README.ru.md') };

/**
 * Взаимные ссылки двух README в сравнение не входят: они обязаны отличаться, и за них отвечает
 * отдельная проверка.
 */
const CROSS_LINKS = new Set(['/README.md', '/README.ru.md']);

/**
 * Ссылки на файлы репозитория (`./docs/...`, `./AGENTS.md`): адрес — то, что читатель откроет.
 * @param {string} text
 * @returns {string[]} отсортированные уникальные пути
 */
function links(text) {
  const found = text.match(/\]\(\.\/[^)#]+\)/gu) ?? [];
  const paths = found.map((match) => match.slice(3, -1)).filter((path) => !CROSS_LINKS.has(path));
  return [...new Set(paths)].sort();
}

/**
 * Имена команд ядра из `package.json#bin`: список в README — инструкция, и отстаёт он молча
 * (до #202 таблица потеряла `harness-cycle-driver` в обоих языках).
 * @type {string[]}
 */
const BIN_NAMES = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).bin);

describe('README: английский и русский', () => {
  test('файлы ссылаются друг на друга', REPO_ONLY, () => {
    assert.match(TEXT.en, /\]\(\.\/README\.ru\.md\)/u, 'README.md ссылается на README.ru.md');
    assert.match(TEXT.ru, /\]\(\.\/README\.md\)/u, 'README.ru.md ссылается на README.md');
  });

  test('каждый bin из package.json назван в обоих README', REPO_ONLY, () => {
    for (const [label, text] of Object.entries(TEXT)) {
      const missing = BIN_NAMES.filter((name) => !text.includes(name));
      assert.deepEqual(missing, [], `${label}: нет команд ${missing.join(', ')}`);
    }
  });

  test('ссылки на документы репозитория совпадают', REPO_ONLY, () => {
    assert.deepEqual(links(TEXT.ru), links(TEXT.en), 'перевод отстал от ссылок');
  });

  test('якорь раздела установки шаблонов не потерян в английском тексте', REPO_ONLY, () => {
    // Внутренняя ссылка на свой раздел: правка заголовка ломает её молча, якорь prettier не проверяет.
    assert.match(
      TEXT.en,
      /\]\(#installing-templates-into-a-project-harness-init\)/u,
      'README.md ссылается на якорь раздела «Installing templates»',
    );
  });
});

/**
 * GitHub-якорь заголовка: нижний регистр, пунктуация и обратные кавычки выброшены, пробелы — в `-`.
 * Правило приближено к GitHub ровно настолько, насколько нужно нашим заголовкам: латиница,
 * кириллица, цифры и дефис остаются.
 * @param {string} heading текст заголовка без `#`
 * @returns {string}
 */
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/gu, '-');
}

/**
 * Каталоги, которые к документации не относятся: зависимости, состояние цикла и артефакты прогонов.
 * Всё это — не текст репозитория, и ссылки оттуда ничего не обещают читателю.
 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.pi', 'coverage', '.next']);

/**
 * Markdown-файлы репозитория, включая корень: ссылку на README ставят и из `docs/`, и из вики.
 * @param {string} dir
 * @returns {string[]} абсолютные пути
 */
function markdownFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...markdownFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith('.md')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

describe('README: якоря ссылок не врут после перевода', () => {
  test('каждый `README*.md#якорь` находит свой заголовок', REPO_ONLY, () => {
    /** @type {Record<string, Set<string>>} */
    const anchors = Object.fromEntries(
      Object.entries(TEXT).map(([label, text]) => [
        label === 'en' ? 'README.md' : 'README.ru.md',
        new Set(
          text
            .split('\n')
            .filter((line) => /^#{1,6} /u.test(line))
            .map((line) => slug(line.replace(/^#{1,6} /u, ''))),
        ),
      ]),
    );

    /** @type {string[]} */
    const broken = [];
    for (const file of markdownFiles(ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(README(?:\.ru)?\.md)#([^)\s]+)/gu)) {
        const target = match[1] ?? '';
        const anchor = decodeURIComponent(match[2] ?? '');
        if (anchors[target]?.has(anchor) !== true)
          broken.push(`${relative(ROOT, file)}: ${match[0]}`);
      }
    }
    assert.deepEqual(broken, [], 'якорь есть только в том README, где заголовок на этом языке');
  });
});
