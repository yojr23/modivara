import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENT_HISTORY_READERS } from '@modivara/core-contracts';
import { rebuildAnalytics, rebuildMetadata } from '../analytics-rebuild.js';
import type { DomainName } from '../domains.js';
import { startHost } from './testing.js';

// Codex #5: analytics:rebuild compone solo los dominios elegidos (MODIVARA_DOMAINS): con commerce + analytics funciona sin
// HOSPITALITY_DATABASE_URL, y sin fuentes aborta antes de vaciar la proyección. Requiere db-test.
const url = (domain: string) => `postgresql://${domain}_app:test@127.0.0.1:55432/modivara_test?schema=${domain}`;
const ENV = ['CORE_DATABASE_URL', 'COMMERCE_DATABASE_URL', 'ANALYTICS_DATABASE_URL', 'HOSPITALITY_DATABASE_URL'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
type Raw = { $queryRawUnsafe<T>(sql: string): Promise<T> };

async function rebuildContext(names: DomainName[]) {
  @Module(rebuildMetadata(names))
  class RebuildModule {}
  return (await Test.createTestingModule({ imports: [RebuildModule] }).compile()).init();
}
const facts = async (db: Raw) => (await db.$queryRawUnsafe<[{ n: number }]>('SELECT count(*)::int AS n FROM stock_movement_facts'))[0].n;

beforeAll(async () => {
  // El host completo limpia las bases y siembra commerce: su stock inicial deja eventos en el outbox de commerce.
  const host = await startHost();
  await host.app.close();
  Object.assign(process.env, { CORE_DATABASE_URL: url('core'), COMMERCE_DATABASE_URL: url('commerce'), ANALYTICS_DATABASE_URL: url('analytics') });
  delete process.env.HOSPITALITY_DATABASE_URL;
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('analytics:rebuild según MODIVARA_DOMAINS', () => {
  it('commerce + analytics: sin HOSPITALITY_DATABASE_URL, solo el lector de commerce, y reconstruye los hechos de stock', async () => {
    const ctx = await rebuildContext(['commerce', 'analytics']);
    try {
      expect(() => ctx.get('HOSPITALITY_PRISMA', { strict: false })).toThrow();
      expect(ctx.get<unknown[]>(EVENT_HISTORY_READERS)).toHaveLength(1);
      const summary = await rebuildAnalytics(ctx);
      expect(summary.applied).toBeGreaterThan(0);
      expect(await facts(ctx.get<Raw>('ANALYTICS_PRISMA', { strict: false }))).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  it('sin analytics falla al componer; sin fuentes aborta sin vaciar la proyección', async () => {
    expect(() => rebuildMetadata(['commerce'])).toThrow(/necesita "analytics"/);
    const ctx = await rebuildContext(['analytics']);
    try {
      const db = ctx.get<Raw>('ANALYTICS_PRISMA', { strict: false });
      const before = await facts(db);
      expect(before).toBeGreaterThan(0);
      await expect(rebuildAnalytics(ctx)).rejects.toThrow(/ninguna fuente/);
      expect(await facts(db)).toBe(before);
    } finally {
      await ctx.close();
    }
  });
});
