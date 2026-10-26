import { describe, expect, it } from 'vitest';
import {
  idempotencyKeySchema,
  adjustToCountSchema,
  createProductSchema,
  registerMovementSchema,
  SEEDED_MOVEMENT_REASONS,
  stockIssuedV1,
  stockReceivedV1,
} from './index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const payload = {
  movement_id: uuid(1),
  stock_location_id: uuid(2),
  product_id: uuid(3),
  product_name: 'Cerveza',
  reason_id: uuid(4),
  reason_name: 'Compra',
  delta: '12.000',
  balance_after: '20.500',
  occurred_at: '2026-10-19T10:00:00-05:00',
  actor_user_id: uuid(5),
};
const envelope = {
  event_id: uuid(10),
  event_type: 'commerce.stock.received',
  event_version: 1,
  occurred_at: '2026-10-19T10:00:00-05:00',
  organization_id: uuid(11),
  location_id: uuid(12),
  aggregate_id: uuid(1),
  correlation_id: uuid(13),
  causation_id: null,
  payload,
};

describe('catálogo', () => {
  it('siembra los 10 motivos de DATA-001 §4', () => {
    expect(SEEDED_MOVEMENT_REASONS).toHaveLength(10);
    expect(SEEDED_MOVEMENT_REASONS.filter((r) => r.direction === 'in')).toHaveLength(2);
    expect(SEEDED_MOVEMENT_REASONS.filter((r) => r.direction === 'out')).toHaveLength(7);
    expect(SEEDED_MOVEMENT_REASONS.filter((r) => r.direction === 'adjust')).toHaveLength(1);
  });
});

describe('eventos', () => {
  it('acepta received con delta positivo', () => {
    expect(stockReceivedV1.safeParse(envelope).success).toBe(true);
  });
  it('rechaza received con delta negativo y cantidades con más de 3 decimales', () => {
    expect(stockReceivedV1.safeParse({ ...envelope, payload: { ...payload, delta: '-1.000' } }).success).toBe(false);
    expect(stockReceivedV1.safeParse({ ...envelope, payload: { ...payload, delta: '1.0001' } }).success).toBe(false);
  });
  it('issued exige delta negativo y rechaza number', () => {
    const issued = { ...envelope, event_type: 'commerce.stock.issued' };
    expect(stockIssuedV1.safeParse({ ...issued, payload: { ...payload, delta: '-2.5' } }).success).toBe(true);
    expect(stockIssuedV1.safeParse({ ...issued, payload: { ...payload, delta: 2.5 } }).success).toBe(false);
    expect(stockIssuedV1.safeParse(issued).success).toBe(false);
  });
});

describe('DTOs', () => {
  it('crea producto con unidad válida', () => {
    expect(createProductSchema.safeParse({ name: ' Ron ', unit: 'bottle' }).data?.name).toBe('Ron');
    expect(createProductSchema.safeParse({ name: 'Ron', unit: 'galon' }).success).toBe(false);
  });
  const mov = {
    stock_location_id: uuid(2),
    product_id: uuid(3),
    reason_id: uuid(4),
  };
  it('in/out exigen cantidad positiva; adjust admite signo pero no cero', () => {
    expect(registerMovementSchema.safeParse({ ...mov, direction: 'in', quantity: '1.5' }).success).toBe(true);
    expect(registerMovementSchema.safeParse({ ...mov, direction: 'out', quantity: '-1' }).success).toBe(false);
    expect(registerMovementSchema.safeParse({ ...mov, direction: 'in', quantity: '0.000' }).success).toBe(false);
    expect(registerMovementSchema.safeParse({ ...mov, direction: 'adjust', quantity: '-3' }).success).toBe(true);
    expect(registerMovementSchema.safeParse({ ...mov, direction: 'adjust', quantity: '0' }).success).toBe(false);
  });
  it('la clave de idempotencia es un uuid en el header, no en el cuerpo', () => {
    expect(idempotencyKeySchema.safeParse(uuid(6)).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('x').success).toBe(false);
    expect('idempotency_key' in registerMovementSchema.shape).toBe(false);
  });
  it('ajuste por conteo acepta cero contado pero no negativo', () => {
    const base = { stock_location_id: uuid(2), product_id: uuid(3), reason_id: uuid(4) };
    expect(adjustToCountSchema.safeParse({ ...base, counted_quantity: '0' }).success).toBe(true);
    expect(adjustToCountSchema.safeParse({ ...base, counted_quantity: '-1' }).success).toBe(false);
  });
});
