import { newId } from '@modivara/core-contracts';
import {
  AddSaleLine, CompleteSale, CreateSellableItem, GetSale, ListSales, OpenLinkedSale, OpenSale, UpdatePosSettings, VoidSale, VoidSaleLine,
} from '../application/use-cases.js';
import { createPosPrisma, type PosPrisma } from '../infrastructure/prisma/client.js';
import { PrismaPosSettingsRepository } from '../infrastructure/prisma/prisma-pos-settings-repository.js';
import { PrismaSaleStore } from '../infrastructure/prisma/prisma-sale-store.js';
import { PrismaSellableItemRepository } from '../infrastructure/prisma/prisma-sellable-item-repository.js';
import { FakeCore, FakeReferenceValidator } from './in-memory.js';

export const TEST_POS_DATABASE_URL = 'postgresql://pos_app:test@127.0.0.1:55432/modivara_test?schema=pos';

export const posPrismaForTests = (): PosPrisma => createPosPrisma(TEST_POS_DATABASE_URL);

/** Deja el esquema pos vacío entre pruebas (las migraciones ya están aplicadas por el globalSetup). */
export async function resetPos(prisma: PosPrisma): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_events, idempotency_keys, sale_external_links, sale_lines, sales, sellable_items, location_settings CASCADE',
  );
}

/** Un negocio con un local (ids sin FK: viven en core). */
export const tenant = () => ({ organizationId: newId(), locationId: newId() });
export type TestTenant = ReturnType<typeof tenant>;

/** Casos de uso reales sobre PostgreSQL, con un local activo de `FakeCore` y un proveedor externo de prueba. */
export function integrationWorld(db: PosPrisma, t: TestTenant = tenant()) {
  const core = new FakeCore();
  core.add({ id: t.locationId, organizationId: t.organizationId });
  const items = new PrismaSellableItemRepository(db);
  const sales = new PrismaSaleStore(db);
  const settings = new PrismaPosSettingsRepository(db);
  const validator = new FakeReferenceValidator();
  const actor = { ...t, actorUserId: newId() };
  return {
    t, actor, core, items, sales, settings, validator,
    createItem: new CreateSellableItem(items, settings, core),
    updateSettings: new UpdatePosSettings(settings, core),
    openSale: new OpenSale(sales, settings, core),
    openLinked: new OpenLinkedSale(sales, settings, [validator], core),
    getSale: new GetSale(sales, core),
    listSales: new ListSales(sales, core),
    addLine: new AddSaleLine(sales, items, core),
    voidLine: new VoidSaleLine(sales, core),
    complete: new CompleteSale(sales, core),
    voidSale: new VoidSale(sales, core),
  };
}
