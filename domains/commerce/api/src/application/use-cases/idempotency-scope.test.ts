import { describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { IdempotencyKeyReusedError } from '../../domain/index.js';
import { ORG, setup, USER } from '../../testing/fixtures.js';

describe('clave de idempotencia entre locales del mismo negocio', () => {
  it('la clave usada en el local B no devuelve el movimiento de B desde el local A', async () => {
    const { h, actor, stockLocation, product, reason, idem } = await setup();
    const locB = newId();
    h.core.add({ id: locB, organizationId: ORG });
    const b = { organizationId: ORG, locationId: locB, actorUserId: USER };
    const stockB = await h.ensureDefaultStockLocation.execute(b);
    const productB = await h.createProduct.execute({ ...b, name: 'Cerveza', unit: 'bottle' });
    const compra = await reason('Compra');
    const key = idem();
    await h.registerMovement.execute({ ...b, stockLocationId: stockB.id, productId: productB.id, direction: 'in', reasonId: compra.id, quantity: '9', idempotencyKey: key });

    const attempt = h.registerMovement.execute({
      ...actor, stockLocationId: stockLocation.id, productId: product.id, direction: 'in', reasonId: compra.id, quantity: '1', idempotencyKey: key,
    });
    await expect(attempt).rejects.toThrow(IdempotencyKeyReusedError);
    await expect(attempt).rejects.toMatchObject({ code: 'idempotency_key_reused', message: expect.not.stringContaining('9') });
    expect(await h.listMovements.execute({ ...actor, productId: product.id })).toEqual([]);
  });

  it('la misma clave sobre otro producto del mismo local también se rechaza', async () => {
    const { h, actor, stockLocation, product, reason, idem } = await setup();
    const other = await h.createProduct.execute({ ...actor, name: 'Ron', unit: 'bottle' });
    const compra = await reason('Compra');
    const key = idem();
    await h.registerMovement.execute({ ...actor, stockLocationId: stockLocation.id, productId: product.id, direction: 'in', reasonId: compra.id, quantity: '1', idempotencyKey: key });
    await expect(
      h.registerMovement.execute({ ...actor, stockLocationId: stockLocation.id, productId: other.id, direction: 'in', reasonId: compra.id, quantity: '1', idempotencyKey: key }),
    ).rejects.toThrow(IdempotencyKeyReusedError);
  });
});
