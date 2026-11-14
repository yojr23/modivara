import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Fitness test (PLAN-POS-001 POS-39): POS es horizontal. Ni su código ni sus dependencias conocen otros productos o rubros;
// esos conceptos solo pueden vivir en adaptadores fuera de domains/pos.
const posRoot = path.resolve(import.meta.dirname, '../..');
const SECTOR = /\b(tables?|table_?id|mesas?|mesero|waiter|restaurant|bar|menu_?item|carta|businessType|business_type|industry|shoe_?size|talla)\b/i;
const FOREIGN = /@modivara\/(hospitality|commerce|analytics)-/;

const sources = readdirSync(posRoot, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.(ts|tsx|json)$/.test(e.name) && !/node_modules|dist/.test(e.parentPath))
  .map((e) => path.join(e.parentPath, e.name))
  .filter((f) => !f.endsWith('.test.ts') && !f.includes('/testing/'));

describe('POS sin sector ni productos ajenos', () => {
  it('hay código que revisar', () => expect(sources.length).toBeGreaterThan(5));
  it.each(sources.map((f) => [path.relative(posRoot, f), f]))('%s', (_, file) => {
    const content = readFileSync(file, 'utf8');
    expect(content).not.toMatch(SECTOR);
    expect(content).not.toMatch(FOREIGN);
  });
});
