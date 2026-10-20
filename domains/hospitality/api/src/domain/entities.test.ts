import { describe, expect, it } from 'vitest';
import { DeviceAssignment, DiningTable, Gateway, InvalidStateError, ValidationError, Zone } from './index.js';

const now = new Date('2026-10-19T10:00:00Z');
const base = { organizationId: crypto.randomUUID(), locationId: crypto.randomUUID(), createdBy: 'u1', now };

describe('DiningTable', () => {
  it('nombre visible con y sin zona', () => {
    const t = DiningTable.create({ ...base, label: ' 5 ' });
    expect(t.displayName(null)).toBe('5');
    expect(t.displayName('Terraza')).toBe('Terraza · 5');
  });
  it('rechaza etiqueta vacía y renombra', () => {
    expect(() => DiningTable.create({ ...base, label: ' ' })).toThrow(ValidationError);
    const t = DiningTable.create({ ...base, label: '5' });
    t.rename('Barra 2', 'u2', now);
    expect(t.label).toBe('Barra 2');
    t.deactivate('u2', now);
    expect(t.isActive).toBe(false);
  });
});

describe('Zone', () => {
  it('exige nombre', () => expect(() => Zone.create({ ...base, name: '' })).toThrow(ValidationError));
});

describe('DeviceAssignment', () => {
  it('se cierra una vez y conserva el historial', () => {
    const a = DeviceAssignment.create({ ...base, deviceId: 'd', tableId: 't', assignedBy: 'u1' });
    a.unassign('u2', now);
    expect(a.isActive).toBe(false);
    expect(() => a.unassign('u2', now)).toThrow(InvalidStateError);
  });
});

describe('Gateway', () => {
  it('guarda solo el hash SHA-256 de la clave', () => {
    const { gateway, plainKey } = Gateway.create({ ...base, name: 'GW' });
    expect(gateway.keyHash).toBe(Gateway.hashKey(plainKey));
    expect(gateway.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(gateway.toProps())).not.toContain(plainKey);
  });

  it('conectividad: umbral de 90 s', () => {
    const { gateway } = Gateway.create({ ...base, name: 'GW' });
    expect(gateway.isConnected(now)).toBe(false);
    gateway.recordHeartbeat(now);
    expect(gateway.isConnected(new Date(now.getTime() + 90_000))).toBe(true);
    expect(gateway.isConnected(new Date(now.getTime() + 90_001))).toBe(false);
  });
});
