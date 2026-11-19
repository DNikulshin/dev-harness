#!/usr/bin/env node
/**
 * Рекурсивно собирает тестовые файлы.
 * @param {string} dir каталог обхода
 * @returns {string[]} абсолютные пути в стабильном порядке
 */
export declare function findTestFiles(dir: string): string[];
/**
 * Запускает тестовые файлы по одному и печатает сводку.
 * @param {string[]} files абсолютные пути тестовых файлов
 * @param {{ execPath?: string, stdio?: 'inherit' | 'pipe' }} [options]
 * @returns {{ failed: string[] }}
 */
export declare function runTests(files: string[], { execPath, stdio }?: {
    execPath?: string;
    stdio?: 'inherit' | 'pipe';
}): {
    failed: string[];
};
