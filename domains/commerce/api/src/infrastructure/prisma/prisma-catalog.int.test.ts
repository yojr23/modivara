import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SEEDED_MOVEMENT_REASONS } from '@modivara/commerce-contracts';
import { newId } from '@modivara/core-contracts';
import {
  CreateMovementReason, CreateProduct, CreateStockLocation, DeactivateProduct, EnsureDefaultStockLocation, ListStockLocations, SeedMovementReasons,
  UpdateProduct,
} from '../../application/index.js';
import { ConflictError } from '../../domain/errors.js';
import { FakeCoreAccess } from '../../testing/fakes.js';
import { commercePrismaForTests, resetCommerce, tenant } from '../../testing/integration.js';
import { PrismaMovementReasonRepository } from './prisma-movement-reason-repository.js';
import { PrismaProductRepository } from './prisma-product-repository.js';
import { PrismaStockLocationRepository } from './prisma-stock-location-repository.js';

const db = commercePrismaForTests();
const t = tenant();
const other = tenant();
const actor = { ...t, actorUserId: newId() };
const core = new FakeCoreAccess();
for (const x of [t, other]) core.add({ id: x.locationId, organizationId: x.organizationId });
const products = new PrismaProductRepository(db);
const places = new PrismaStockLocationRepository(db);
const reasons = new PrismaMovementReasonRepository(db);

beforeEach(() => resetCommerce(db));
afterAll(() => db.$disconnect());

describe('productos', () => {
  const create = new CreateProduct(products, core);

  it('persiste y recupera el agregado; findById respeta negocio y local', async () => {
    const p = await create.execute({ ...actor, name: ' Cerveza ', sku: 'C-1', category: 'Bebidas', unit: 'bottle' });
    const found = await products.findById({ id: p.id, ...t });
    expect(found?.toProps()).toEqual(p.toProps());
    expect(await products.findById({ id: p.id, ...other })).toBeNull();
    expect(await products.findById({ id: p.id, organizationId: t.organizationId, locationId: newId() })).toBeNull();
  });

  it('nombre (sin distinguir mayúsculas) y SKU únicos solo entre activos', async () => {
    const p = await create.execute({ ...actor, name: 'Cerveza', sku: 'C-1', unit: 'bottle' });
    await expect(create.execute({ ...actor, name: 'cerveza', unit: 'unit' })).rejects.toThrow(ConflictError);
    await expect(create.execute({ ...actor, name: 'Otra', sku: 'C-1', unit: 'unit' })).rejects.toThrow(ConflictError);
    // el mismo nombre en otro local o negocio es válido
    await expect(create.execute({ ...other, actorUserId: newId(), name: 'Cerveza', sku: 'C-1', unit: 'bottle' })).resolves.toBeDefined();
    await new DeactivateProduct(products, core).execute({ ...actor, productId: p.id });
    await expect(create.execute({ ...actor, name: 'Cerveza', sku: 'C-1', unit: 'bottle' })).resolves.toBeDefined();
  });

  it('la carrera de dos altas con el mismo nombre termina en ConflictError, no en un error de la base', async () => {
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => create.execute({ ...actor, name: 'Ron', unit: 'bottle' })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictError);
  });

  it('los comodines de LIKE en el nombre no coinciden con otros nombres', async () => {
    await create.execute({ ...actor, name: 'Ron', unit: 'bottle' });
    expect(await products.findActiveByName({ ...t, name: 'R%' })).toBeNull();
    expect(await products.findActiveByName({ ...t, name: 'R_n' })).toBeNull();
    expect((await products.findActiveByName({ ...t, name: 'RON' }))?.name).toBe('Ron');
  });

  it('actualiza y lista (activos e inactivos, por nombre, solo del local)', async () => {
    const a = await create.execute({ ...actor, name: 'Zumo', unit: 'l' });
    const b = await create.execute({ ...actor, name: 'Agua', unit: 'bottle' });
    await create.execute({ ...other, actorUserId: newId(), name: 'Ajeno', unit: 'unit' });
    await new UpdateProduct(products, core).execute({ ...actor, productId: a.id, sku: 'Z1', category: null });
    await new DeactivateProduct(products, core).execute({ ...actor, productId: b.id });
    const list = await products.list(t);
    expect(list.map((p) => [p.name, p.isActive, p.sku])).toEqual([['Agua', false, null], ['Zumo', true, 'Z1']]);
    expect((await products.findById({ id: a.id, ...t }))?.toProps().updatedBy).toBe(actor.actorUserId);
  });
});

describe('lugares de stock', () => {
  const ensure = new EnsureDefaultStockLocation(places, core);
  const create = new CreateStockLocation(places, core);

  it('un solo «Principal» predeterminado activo por local, y es idempotente', async () => {
    const a = await ensure.execute(actor);
    expect(await ensure.execute(actor)).toMatchObject({ id: a.id });
    expect((await places.findActiveDefault(t))?.id).toBe(a.id);
    expect(await places.findActiveDefault(other)).toBeNull();
    const second = await ensure.execute({ ...other, actorUserId: newId() });
    expect(second.id).not.toBe(a.id);
  });

  it('nombre único entre activos del local; el predeterminado duplicado lo rechaza la base', async () => {
    await ensure.execute(actor);
    await expect(create.execute({ ...actor, name: 'principal' })).rejects.toThrow(ConflictError);
    await create.execute({ ...actor, name: 'Barra' });
    await expect(create.execute({ ...actor, name: 'BARRA' })).rejects.toThrow(ConflictError);
    const racing = await Promise.allSettled([1, 2, 3].map(() => ensure.execute({ ...other, actorUserId: newId() })));
    expect(await db.stockLocation.count({ where: { ...other, isDefault: true } })).toBe(1);
    for (const r of racing) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictError);
  });

  it('el listado pone «Principal» primero y crea el predeterminado de forma perezosa sin duplicarlo en paralelo', async () => {
    const list = new ListStockLocations(places, core, ensure);
    await create.execute({ ...other, actorUserId: newId(), name: 'Barra' });
    const results = await Promise.all([1, 2, 3].map(() => list.execute({ ...other, actorUserId: newId() })));
    expect(results[0]!.map((s) => s.name)).toEqual(['Principal', 'Barra']);
    expect(await db.stockLocation.count({ where: { ...other, isDefault: true } })).toBe(1);
  });
});

describe('motivos', () => {
  it('siembra los de DATA-001 §4 por negocio, sin duplicar al repetir', async () => {
    const seed = new SeedMovementReasons(reasons);
    expect(await seed.execute(actor)).toHaveLength(SEEDED_MOVEMENT_REASONS.length);
    expect(await seed.execute(actor)).toHaveLength(0);
    const listed = await reasons.list(t);
    expect(listed.map((r) => [r.name, r.direction]).sort()).toEqual(SEEDED_MOVEMENT_REASONS.map((r) => [r.name, r.direction]).sort());
    expect(await reasons.list(other)).toEqual([]);
    expect(await reasons.findActiveByName({ ...t, name: 'COMPRA' })).toMatchObject({ direction: 'in' });
    expect(await reasons.findById({ id: listed[0]!.id, ...other })).toBeNull();
  });

  it('nombre único entre activos del negocio', async () => {
    const create = new CreateMovementReason(reasons);
    const r = await create.execute({ ...actor, name: 'Regalo', direction: 'out' });
    await expect(create.execute({ ...actor, name: 'regalo', direction: 'in' })).rejects.toThrow(ConflictError);
    r.deactivate(actor.actorUserId, new Date());
    await reasons.save(r);
    await expect(create.execute({ ...actor, name: 'Regalo', direction: 'in' })).resolves.toBeDefined();
  });
});
