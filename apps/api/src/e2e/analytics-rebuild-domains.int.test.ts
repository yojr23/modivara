import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENT_HISTORY_READERS, newId, type IntegrationEventSubscriber } from '@modivara/core-contracts';
import { rebuildAnalytics, rebuildMetadata } from '../analytics-rebuild.js';
import type { DomainName } from '../domains.js';
import { startHost } from './testing.js';

// Codex #5: analytics:rebuild compone solo los dominios elegidos (MODIVARA_DOMAINS): con commerce + analytics funciona sin
// HOSPITALITY_DATABASE_URL, no toca los hechos de una fuente no compuesta y sin fuentes aborta antes de vaciar la proyección. Requiere db-test.
const url = (domain: string) => `postgresql://${domain}_app:test@127.0.0.1:55432/modivara_test?schema=${domain}`;
const ENV = ['CORE_DATABASE_URL', 'COMMERCE_DATABASE_URL', 'ANALYTICS_DATABASE_URL', 'HOSPITALITY_DATABASE_URL'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
type Raw = { $queryRawUnsafe<T>(sql: string): Promise<T> };

async function rebuildContext(names: DomainName[]) {
  @Module(rebuildMetadata(names))
  class RebuildModule {}
  return (await Test.createTestingModule({ imports: [RebuildModule] }).compile()).init();
}
const count = async (db: Raw, sql: string) => (await db.$queryRawUnsafe<[{ n: number }]>(`SELECT count(*)::int AS n FROM ${sql}`))[0].n;
const facts = (db: Raw) => count(db, 'stock_movement_facts');

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
      const summary = await rebuildAnalytics(ctx, ['commerce', 'analytics']);
      expect(summary.applied).toBeGreaterThan(0);
      expect(await facts(ctx.get<Raw>('ANALYTICS_PRISMA', { strict: false }))).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  it('rebuilding with commerce only keeps hospitality facts and their processed_events intact', async () => {
    const ctx = await rebuildContext(['commerce', 'analytics']);
    try {
      const db = ctx.get<Raw>('ANALYTICS_PRISMA', { strict: false });
      // Un llamado que hospitality proyectó cuando estaba compuesto: commerce + analytics no puede rehacerlo.
      const call = newId();
      await ctx.get<IntegrationEventSubscriber>('ANALYTICS_EVENT_SUBSCRIBER', { strict: false }).handle({
        event_id: newId(), event_type: 'hospitality.service_call.created', event_version: 1, occurred_at: '2026-10-19T15:00:00Z',
        organization_id: newId(), location_id: newId(), aggregate_id: call, correlation_id: newId(), causation_id: null,
        payload: { service_call_id: call, table_id: newId(), table_label: 'M2', zone_id: null, zone_name: null, call_type: 'attention', created_at: '2026-10-19T15:00:00Z' },
      });
      const hospitality = async () => [await count(db, 'service_call_facts'), await count(db, "processed_events WHERE event_type LIKE 'hospitality.%'")];
      expect(await hospitality()).toEqual([1, 1]);
      expect((await rebuildAnalytics(ctx, ['commerce', 'analytics'])).applied).toBeGreaterThan(0);
      expect(await hospitality()).toEqual([1, 1]);
      expect(await facts(db)).toBeGreaterThan(0);
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
      await expect(rebuildAnalytics(ctx, ['analytics'])).rejects.toThrow(/ninguna fuente/);
      expect(await facts(db)).toBe(before);
    } finally {
      await ctx.close();
    }
  });
});
