import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { analyticsPrismaForTests, resetAnalytics, tenant } from '../../testing/integration.js';

// La base garantiza la forma de las proyecciones (DATA-001 §5, F5-01).
const db = analyticsPrismaForTests();
beforeEach(() => resetAnalytics(db));
afterAll(() => db.$disconnect());

const t = tenant();
const call = (data: Record<string, unknown> = {}) => ({
  serviceCallId: newId(), ...t, tableId: newId(), tableLabel: 'Mesa 1', callType: 'attention', createdAt: new Date(), ...data,
});

describe('migración analytics 0001', () => {
  it('processed_events: event_id es la clave; processed_at por defecto', async () => {
    const eventId = newId();
    const row = await db.processedEvent.create({ data: { eventId, eventType: 'x' } });
    expect(row.processedAt).toBeInstanceOf(Date);
    await expect(db.processedEvent.create({ data: { eventId, eventType: 'x' } })).rejects.toThrow();
  });

  it('service_call_facts: press_count 1 por defecto, opcionales nulos, mesa/tipo/fecha obligatorios', async () => {
    const row = await db.serviceCallFact.create({ data: call() as never });
    expect(row).toMatchObject({ pressCount: 1, zoneId: null, zoneName: null, acknowledgedAt: null, completedAt: null });
    await expect(db.$executeRaw`INSERT INTO service_call_facts (service_call_id, organization_id, location_id, table_id, table_label, call_type)
      VALUES (${newId()}::uuid, ${t.organizationId}::uuid, ${t.locationId}::uuid, ${newId()}::uuid, 'M', 'attention')`).rejects.toThrow(); // sin created_at
    await expect(db.serviceCallFact.create({ data: call({ serviceCallId: row.serviceCallId }) as never })).rejects.toThrow(); // PK
  });

  it('stock_movement_facts: numeric(12,3) y timestamptz', async () => {
    const [cols] = await db.$queryRaw<{ n: string }[]>`
      SELECT string_agg(column_name || ':' || data_type || ':' || coalesce(numeric_precision::text,'') || ',' || coalesce(numeric_scale::text,''), ' ' ORDER BY column_name) AS n
      FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'stock_movement_facts' AND column_name IN ('delta','balance_after','occurred_at')`;
    expect(cols?.n).toBe('balance_after:numeric:12,3 delta:numeric:12,3 occurred_at:timestamp with time zone:,');
  });

  it('índices por periodo y sin claves foráneas', async () => {
    const idx = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname LIKE 'ix_%'`;
    const defs = Object.fromEntries(idx.map((i) => [i.indexname, i.indexdef]));
    expect(defs['ix_service_call_facts_period']).toMatch(/\(location_id, created_at\)/);
    expect(defs['ix_stock_movement_facts_period']).toMatch(/\(location_id, occurred_at\)/);
    const [fks] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.table_constraints WHERE constraint_schema = current_schema() AND constraint_type = 'FOREIGN KEY'`;
    expect(fks?.n).toBe(0n);
  });
});
