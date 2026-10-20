import { describe, expect, it } from 'vitest';
import {
  BOARD_AMBER_AFTER_MS,
  GATEWAY_DISCONNECTED_AFTER_MS,
  gatewayHeartbeatMessageSchema,
  gatewayPressMessageSchema,
  serviceCallAcknowledgedEventSchema,
  serviceCallCompletedEventSchema,
  serviceCallCreatedEventSchema,
  waitLevel,
} from './index.js';

const id = () => crypto.randomUUID();
const envelope = (type: string) => ({
  event_id: id(),
  event_type: type,
  event_version: 1,
  occurred_at: '2026-10-19T10:00:00.000Z',
  organization_id: id(),
  location_id: id(),
  aggregate_id: id(),
  correlation_id: id(),
  causation_id: null,
});

describe('eventos v1 de hospitality', () => {
  it('acepta created con y sin zona', () => {
    const base = { service_call_id: id(), table_id: id(), table_label: '5', call_type: 'attention', created_at: '2026-10-19T10:00:00Z' };
    const ok = (zone: { zone_id: string | null; zone_name: string | null }) =>
      serviceCallCreatedEventSchema.safeParse({ ...envelope('hospitality.service_call.created'), payload: { ...base, ...zone } }).success;
    expect(ok({ zone_id: id(), zone_name: 'Terraza' })).toBe(true);
    expect(ok({ zone_id: null, zone_name: null })).toBe(true);
  });

  it('rechaza un call_type desconocido y el tipo de evento equivocado', () => {
    const payload = { service_call_id: id(), table_id: id(), table_label: '5', zone_id: null, zone_name: null, call_type: 'bill', created_at: '2026-10-19T10:00:00Z' };
    expect(serviceCallCreatedEventSchema.safeParse({ ...envelope('hospitality.service_call.created'), payload }).success).toBe(false);
    expect(serviceCallCreatedEventSchema.safeParse({ ...envelope('hospitality.service_call.completed'), payload: { ...payload, call_type: 'attention' } }).success).toBe(false);
  });

  it('acknowledged y completed exigen press_count >= 1 y actor uuid', () => {
    const ack = { service_call_id: id(), acknowledged_at: '2026-10-19T10:01:00Z', acknowledged_by: id(), press_count: 2 };
    expect(serviceCallAcknowledgedEventSchema.safeParse({ ...envelope('hospitality.service_call.acknowledged'), payload: ack }).success).toBe(true);
    expect(serviceCallAcknowledgedEventSchema.safeParse({ ...envelope('hospitality.service_call.acknowledged'), payload: { ...ack, press_count: 0 } }).success).toBe(false);
    const done = { service_call_id: id(), completed_at: '2026-10-19T10:02:00Z', completed_by: 'x', press_count: 1 };
    expect(serviceCallCompletedEventSchema.safeParse({ ...envelope('hospitality.service_call.completed'), payload: done }).success).toBe(false);
  });
});

describe('mensajes del gateway', () => {
  it('button_key y sent_at son opcionales', () => {
    expect(gatewayPressMessageSchema.safeParse({ device_code: 'BTN-1' }).success).toBe(true);
    expect(gatewayPressMessageSchema.safeParse({ device_code: 'BTN-1', button_key: 'A', sent_at: '2026-10-19T10:00:00Z' }).success).toBe(true);
  });
  it('rechaza código vacío o fecha inválida', () => {
    expect(gatewayPressMessageSchema.safeParse({ device_code: '' }).success).toBe(false);
    expect(gatewayPressMessageSchema.safeParse({ device_code: 'a', sent_at: 'ayer' }).success).toBe(false);
  });
  it('la señal de vida acepta vacío', () => {
    expect(gatewayHeartbeatMessageSchema.safeParse({}).success).toBe(true);
  });
});

describe('constantes del tablero', () => {
  it('ámbar a los 2 min y rojo a los 5', () => {
    expect(waitLevel(BOARD_AMBER_AFTER_MS - 1)).toBe('normal');
    expect(waitLevel(2 * 60_000)).toBe('amber');
    expect(waitLevel(5 * 60_000)).toBe('red');
    expect(GATEWAY_DISCONNECTED_AFTER_MS).toBe(90_000);
  });
});
