import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('domain sin Zod de transporte (TECH-001 §5)', () => {
  it('ningún archivo de domain usa esquemas Zod', () => {
    const dir = new URL('.', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(src, f).not.toMatch(/Schema|safeParse|from 'zod'/);
    }
  });
});
