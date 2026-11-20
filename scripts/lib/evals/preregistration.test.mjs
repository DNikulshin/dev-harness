import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

import { LINE_TOLERANCE } from '../../cycle-metrics.mjs';
import { DEFAULT_THRESHOLDS } from '../../evals-score.mjs';
import { loadSeeds } from './seeds.mjs';
import {
  MIN_REPEATS,
  PREREGISTRATION_PATH,
  extractPreregistrationBlock,
  loadPreregistration,
  readPreregistration,
} from './preregistration.mjs';

/** Корень репозитория: тест не зависит от текущего каталога запуска. */
const ROOT = resolve(import.meta.dirname, '..', '..', '..');

/** Путь протокола. */
const FILE = join(ROOT, PREREGISTRATION_PATH);

/** Валидный блок протокола: от него отличаются отрицательные тесты. */
const VALID = {
  version: 1,
  since: '2026-11-20',
  min_repeats: 3,
  thresholds: { completeness: 0.8, false_positive_max: 0.2, line_tolerance: 5 },
  seeds: ['E1', 'E2'],
};

/**
 * Копия валидного блока с правкой одного поля.
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown>}
 */
function blockWith(patch) {
  return { ...VALID, ...patch };
}

describe('пред-регистрация: разбор', () => {
  test('валидный блок проходит и нормализует порядок сидов', () => {
    const result = readPreregistration(blockWith({ seeds: ['E10', 'E2', 'E1'] }));
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.deepEqual(result.prereg?.seeds, ['E1', 'E2', 'E10']);
  });

  test('нет блока, несколько блоков, битый JSON — ошибки, а не дефолт', () => {
    assert.match(extractPreregistrationBlock('без блока').errors.join('\n'), /нет блока/u);
    assert.match(
      extractPreregistrationBlock('```json\n{}\n```\n\n```json\n{}\n```').errors.join('\n'),
      /больше одного/u,
    );
    assert.match(readPreregistration('{').errors.join('\n'), /не разбирается/u);
    assert.equal(readPreregistration([]).ok, false);
  });

  test('неизвестное поле, отсутствие поля и мусор в типах — ошибки', () => {
    assert.match(
      readPreregistration(blockWith({ extra: 1 })).errors.join('\n'),
      /неизвестные поля extra/u,
    );
    const { since, ...withoutSince } = VALID;
    assert.ok(since);
    assert.match(readPreregistration(withoutSince).errors.join('\n'), /нет полей since/u);
    assert.match(readPreregistration(blockWith({ version: 0 })).errors.join('\n'), /version/u);
    assert.match(
      readPreregistration(blockWith({ since: '20.11.2026' })).errors.join('\n'),
      /since/u,
    );
    assert.match(
      readPreregistration(
        blockWith({ thresholds: { ...VALID.thresholds, line_tolerance: -1 } }),
      ).errors.join('\n'),
      /line_tolerance/u,
    );
    assert.match(
      readPreregistration(
        blockWith({ thresholds: { ...VALID.thresholds, completeness: 1.5 } }),
      ).errors.join('\n'),
      /completeness/u,
    );
  });

  test('минимум повторов ниже §15, пустой и дублирующий набор — ошибки', () => {
    assert.match(
      readPreregistration(blockWith({ min_repeats: 2 })).errors.join('\n'),
      /min_repeats/u,
    );
    assert.match(readPreregistration(blockWith({ seeds: [] })).errors.join('\n'), /пустой набор/u);
    assert.match(
      readPreregistration(blockWith({ seeds: ['E1', 'E1'] })).errors.join('\n'),
      /уже объявлен/u,
    );
    assert.match(readPreregistration(blockWith({ seeds: ['X1'] })).errors.join('\n'), /E<номер>/u);
  });

  test('битый протокол на диске — исключение с объяснением, а не тихий дефолт', () => {
    assert.throws(() => loadPreregistration(join(ROOT, 'нет-такого-файла.md')), /ENOENT/u);
  });
});

describe('пред-регистрация: сверка с кодом и набором', () => {
  const prereg = loadPreregistration(FILE);

  test('пороги протокола совпадают с кодом, иначе проверка красная', () => {
    assert.equal(prereg.thresholds.completeness, DEFAULT_THRESHOLDS.completeness);
    assert.equal(prereg.thresholds.false_positive_max, DEFAULT_THRESHOLDS.false_positive_max);
    assert.equal(prereg.thresholds.line_tolerance, LINE_TOLERANCE);
  });

  test('минимум повторов не ниже §15, версия и дата заполнены', () => {
    assert.equal(prereg.min_repeats, MIN_REPEATS);
    assert.ok(prereg.version >= 1);
    assert.match(prereg.since, /^\d{4}-\d{2}-\d{2}$/u);
  });

  test('набор сидов протокола равен файлам каталога: расширение набора — только с записью', () => {
    const seeds = loadSeeds(join(ROOT, 'evals', 'orchestrator', 'seeds')).map((seed) => seed.id);
    assert.deepEqual(prereg.seeds, seeds);
  });

  test('правило слепоты и «недостаточно данных ≠ ok» записаны письменно', () => {
    const text = readFileSync(FILE, 'utf8');
    assert.match(text, /Слепота оценщика/u);
    assert.match(text, /`evidence\/`/u);
    assert.match(text, /plan\.\*/u);
    assert.match(text, /insufficient_data/u);
    assert.match(text, /История изменений/u);
  });
});
