import { describe, expect, it } from 'vitest';
import { Entitlement } from './entitlement.js';
import { ValidationError } from '@modivara/core-contracts';

describe('Entitlement', () => {
  it('habilitado por defecto y solo para módulos conocidos', () => {
    expect(Entitlement.create({ organizationId: 'o1', module: 'commerce' }).enabled).toBe(true);
    expect(() => Entitlement.create({ organizationId: 'o1', module: 'billing' })).toThrow(ValidationError);
  });
});
