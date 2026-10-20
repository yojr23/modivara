import { describe, expect, it } from 'vitest';
import { Entitlement } from './entitlement.js';
import { ValidationError } from '@modivara/core-contracts';

describe('Entitlement', () => {
  it('habilitado por defecto y solo para módulos conocidos', () => {
    expect(Entitlement.create({ organizationId: 'o1', module: 'commerce' }).enabled).toBe(true);
    expect(() => Entitlement.create({ organizationId: 'o1', module: 'billing' })).toThrow(ValidationError);
  });
});

describe('Entitlement.restore / setEnabled', () => {
  it('restaura sin validar y permite cambiar el estado sin tocar el original', () => {
    const props = { organizationId: 'o1', module: 'analytics' as const, enabled: false };
    const e = Entitlement.restore(props);
    e.setEnabled(true);
    expect(e.enabled).toBe(true);
    expect(props.enabled).toBe(false);
  });
});
