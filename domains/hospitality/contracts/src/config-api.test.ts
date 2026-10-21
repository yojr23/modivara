import { describe, expect, it } from 'vitest';
import { createTableSchema, deviceStatusSchema, updateTableSchema } from './config-api.js';

describe('API de configuración', () => {
  it('mesa con o sin zona; etiqueta obligatoria', () => {
    expect(createTableSchema.safeParse({ label: '5' }).success).toBe(true);
    expect(createTableSchema.safeParse({ label: '3', zone_id: null }).success).toBe(true);
    expect(createTableSchema.safeParse({ label: ' ' }).success).toBe(false);
  });

  it('una actualización vacía se rechaza', () => {
    expect(updateTableSchema.safeParse({}).success).toBe(false);
  });

  it('el estado de botones no admite datos técnicos', () => {
    const parsed = deviceStatusSchema.parse({
      connectivity: 'all_connected',
      tables: [{ table_id: '0192d4f0-0000-7000-8000-000000000001', has_button: true, code: 'btn-01', gateway_id: 'x' }],
    });
    expect(parsed.tables[0]).toEqual({ table_id: '0192d4f0-0000-7000-8000-000000000001', has_button: true });
  });
});
