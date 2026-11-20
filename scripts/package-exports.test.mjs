/**
 * Публичная поверхность пакета (issue #77): что обещано потребителю, а что — внутреннее.
 *
 * ADR [0004](../docs/adr/0004-core-runtime-adapters.md) запрещает адаптеру импортировать внутренности
 * ядра (`scripts/lib/**`). Запрет без механизма — пожелание: пока в `exports` стоял шаблон
 * `./scripts/*`, импортировать можно было что угодно, включая тесты и фикстуры. Здесь правило
 * превращается в проверку: каждый `bin` обязан иметь явный ключ `exports`, а всё остальное —
 * закрыто.
 *
 * Тест читает `package.json` репозитория, поэтому падает на изменении карты, а не на поведении
 * установленного пакета; установка и импорт проверяются в `package-consumer.test.mjs`. Разделение
 * осознанное: здесь — состав контракта, там — что контракт действительно работает.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

/** Корень репозитория: родитель каталога `scripts/`. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Разобранный `package.json` ядра. */
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** @type {Record<string, unknown>} */
const EXPORTS = PKG.exports;

/**
 * Единственный внутренний модуль, который остаётся публичным: шов библиотеки, обещанный README
 * (`loadConfig` — чтобы читать конфиг проекта из своего кода, а не через CLI). Любое расширение
 * этого списка — изменение публичного API, а не деталь реализации.
 */
const LIBRARY_SEAM = './scripts/lib/cycle/config';

/**
 * Имя точки входа из пути `bin`: `./scripts/cycle-state.mjs` → `cycle-state`.
 * @param {string} target
 * @returns {string}
 */
function stem(target) {
  const last = target.split('/').pop() ?? target;
  return last.replace(/\.mjs$/u, '');
}

describe('package: публичная поверхность', () => {
  test('у каждого bin есть явный export с тем же файлом и своими типами', () => {
    /** @type {string[]} */
    const missing = [];
    for (const [name, target] of Object.entries(PKG.bin)) {
      const key = `./scripts/${stem(target)}`;
      const entry = EXPORTS[key];
      if (entry === undefined) {
        missing.push(`${name} → ${key}`);
        continue;
      }
      assert.deepEqual(entry, {
        types: `./types/${stem(target)}.d.mts`,
        default: target,
      });
    }
    assert.deepEqual(missing, [], 'bin без соответствующего ключа exports');
  });

  test('шаблоны и package.json остаются доступны потребителю', () => {
    assert.equal(EXPORTS['./templates/*'], './templates/*');
    assert.equal(EXPORTS['./package.json'], './package.json');
  });

  test('внутренности закрыты: нет шаблонов и ключей под scripts/lib, кроме шва библиотеки', () => {
    const keys = Object.keys(EXPORTS);
    assert.deepEqual(
      keys.filter((key) => key.includes('*') && key.startsWith('./scripts/')),
      [],
      'шаблонный ключ под scripts/ снова открывает весь каталог',
    );
    assert.deepEqual(
      keys.filter((key) => key.startsWith('./scripts/lib') && key !== LIBRARY_SEAM),
      [],
      'внутренние модули открыты как публичный API',
    );
    assert.deepEqual(EXPORTS[LIBRARY_SEAM], {
      types: './types/lib/cycle/config.d.mts',
      default: './scripts/lib/cycle/config.mjs',
    });
    for (const key of keys.filter((candidate) => candidate.startsWith('./scripts/'))) {
      if (key === LIBRARY_SEAM) continue;
      const entry = /** @type {{ default?: string }} */ (EXPORTS[key]);
      assert.match(
        String(entry.default),
        /^\.\/scripts\/[a-z][a-z-]*\.mjs$/u,
        `ключ ${key} должен указывать на скрипт верхнего уровня, а не на подкаталог`,
      );
    }
  });
});
