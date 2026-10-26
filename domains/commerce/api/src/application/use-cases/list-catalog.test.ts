import { describe, expect, it } from 'vitest';
import { SEEDED_MOVEMENT_REASONS } from '@modivara/commerce-contracts';
import { LocationUnavailableError } from '../../domain/index.js';
import { OTHER_LOC, OTHER_ORG, setup, USER } from '../../testing/fixtures.js';

describe('listados', () => {
  it('productos: solo los del local del actor, incluidos los desactivados', async () => {
    const { h, actor, product } = await setup();
    const ron = await h.createProduct.execute({ ...actor, name: 'Ron', unit: 'bottle' });
    await h.deactivateProduct.execute({ ...actor, productId: ron.id });
    await h.createProduct.execute({ organizationId: OTHER_ORG, locationId: OTHER_LOC, actorUserId: USER, name: 'Ajeno', unit: 'unit' });
    expect((await h.listProducts.execute(actor)).map((p) => p.name)).toEqual([product.name, 'Ron']);
    await expect(h.listProducts.execute({ ...actor, locationId: OTHER_LOC })).rejects.toThrow(LocationUnavailableError);
  });

  it('lugares de stock: asegura «Principal» de forma perezosa y sin duplicarlo', async () => {
    const { h } = await setup();
    const other = { organizationId: OTHER_ORG, locationId: OTHER_LOC, actorUserId: USER };
    expect((await h.listStockLocations.execute(other)).map((s) => [s.name, s.isDefault])).toEqual([['Principal', true]]);
    await h.createStockLocation.execute({ ...other, name: 'Barra' });
    expect((await h.listStockLocations.execute(other)).map((s) => s.name)).toEqual(['Principal', 'Barra']);
  });

  it('motivos: los del negocio, por dirección', async () => {
    const { h, actor } = await setup();
    const list = await h.listMovementReasons.execute(actor);
    expect(list).toHaveLength(SEEDED_MOVEMENT_REASONS.length);
    expect(list[0]!.direction).toBe('adjust');
    expect(await h.listMovementReasons.execute({ organizationId: OTHER_ORG, actorUserId: USER })).toEqual([]);
  });
});
