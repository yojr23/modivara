import { createHash } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { BootstrapPlatform, ProvisionOrganization } from '@modivara/core-api';
import {
  CreateProduct, EnsureDefaultStockLocation, ListMovementReasons, ListProducts, RegisterMovement, SeedMovementReasons, type StockContext,
} from '@modivara/commerce-api';
import type { Unit } from '@modivara/commerce-contracts';
import { BUSINESSES, MODULES, SUPERADMIN } from './core.js';

// DATA-001 §7: «unos 10 productos con stock inicial y motivos sembrados». OPEN: el documento no fija cuáles ni cuánto stock; es un surtido de bar inventado.
const BAR_PRODUCTS: ReadonlyArray<{ name: string; unit: Unit; category: string; stock: string }> = [
  { name: 'Cerveza', unit: 'bottle', category: 'Cervezas', stock: '48' },
  { name: 'Cerveza artesanal', unit: 'bottle', category: 'Cervezas', stock: '24' },
  { name: 'Ron', unit: 'bottle', category: 'Licores', stock: '12' },
  { name: 'Aguardiente', unit: 'bottle', category: 'Licores', stock: '12' },
  { name: 'Whisky', unit: 'bottle', category: 'Licores', stock: '8' },
  { name: 'Vodka', unit: 'bottle', category: 'Licores', stock: '8' },
  { name: 'Gaseosa', unit: 'bottle', category: 'Sin alcohol', stock: '36' },
  { name: 'Agua', unit: 'bottle', category: 'Sin alcohol', stock: '36' },
  { name: 'Limón', unit: 'kg', category: 'Insumos', stock: '5.5' },
  { name: 'Hielo', unit: 'kg', category: 'Insumos', stock: '40' },
];

/** Misma entrada inicial = misma clave: repetir el seed no suma el stock otra vez (el movimiento original se devuelve). */
const seedKey = (locationId: string, productName: string): string => {
  const h = createHash('sha256').update(`seed:commerce:${locationId}:${productName}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/**
 * Solo casos de uso públicos de core y commerce; idempotente (lo que ya existe no se toca ni se duplica).
 * Llama a los mismos casos de uso que el suscriptor de `core.location.created` (motivos del negocio y «Principal») para locales
 * anteriores al evento o cuyo evento aún no se entregó: el proceso de seed no corre pollers (`outbox: false`).
 * Requiere haber corrido `seed:core`.
 */
export async function seedCommerce(app: INestApplicationContext, password: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:commerce se niega a correr con NODE_ENV=production: es solo para datos de demo.');
  }
  const root = await app.get(BootstrapPlatform).execute({ ...SUPERADMIN, password });
  const provision = app.get(ProvisionOrganization);

  for (const b of BUSINESSES) {
    const { organization, locations } = await provision.execute({ actor: root, slug: b.slug, name: b.name, locations: [{ name: b.location }], modules: MODULES });
    const ctx: StockContext = { organizationId: organization.id, locationId: locations[0]!.id, actorUserId: root.actorUserId };

    await app.get(SeedMovementReasons).execute(ctx);
    const stockLocation = await app.get(EnsureDefaultStockLocation).execute(ctx);
    const reasons = await app.get(ListMovementReasons).execute(ctx);
    const purchase = reasons.find((r) => r.isActive && r.name === 'Compra');
    if (!purchase) throw new Error('El motivo «Compra» no existe: el negocio lo desactivó o cambió; el seed no puede dar entrada inicial.');

    const existing = new Map((await app.get(ListProducts).execute(ctx)).map((p) => [p.name, p]));
    for (const p of BAR_PRODUCTS) {
      const product = existing.get(p.name) ?? (await app.get(CreateProduct).execute({ ...ctx, name: p.name, unit: p.unit, category: p.category }));
      await app.get(RegisterMovement).execute({
        ...ctx, stockLocationId: stockLocation.id, productId: product.id, reasonId: purchase.id, direction: 'in', quantity: p.stock,
        note: 'Stock inicial (seed)', idempotencyKey: seedKey(ctx.locationId, p.name),
      });
    }
  }
}
