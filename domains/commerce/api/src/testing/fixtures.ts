import type { Unit } from '@modivara/commerce-contracts';
import { createHarness } from './harness.js';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
export const LOC = '33333333-3333-4333-8333-333333333333';
export const OTHER_LOC = '44444444-4444-4444-8444-444444444444';
export const USER = '55555555-5555-4555-8555-555555555555';

export type Harness = ReturnType<typeof createHarness>;

/** Un negocio con un local, lugar "Principal", motivos sembrados y un producto. */
export async function setup(overrides: { unit?: Unit } = {}) {
  const h = createHarness();
  h.core.add({ id: LOC, organizationId: ORG });
  h.core.add({ id: OTHER_LOC, organizationId: OTHER_ORG });
  const actor = { organizationId: ORG, actorUserId: USER, locationId: LOC };
  const stockLocation = await h.ensureDefaultStockLocation.execute(actor);
  await h.seedMovementReasons.execute(actor);
  const product = await h.createProduct.execute({ ...actor, name: 'Cerveza', unit: overrides.unit ?? 'bottle' });
  const reason = async (name: string) => {
    const r = await h.reasons.findActiveByName(ORG, name);
    if (!r) throw new Error(`motivo ${name} no sembrado`);
    return r;
  };
  let key = 0;
  const idem = () => `99999999-9999-4999-8999-${String(++key).padStart(12, '0')}`;
  return { h, actor, stockLocation, product, reason, idem };
}
