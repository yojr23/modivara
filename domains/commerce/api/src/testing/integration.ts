import { newId } from '@modivara/core-contracts';
import {
  AdjustToCount, CreateProduct, EnsureDefaultStockLocation, GetBalances, ListMovements, MovementRecorder, RegisterMovement, SeedMovementReasons,
} from '../application/index.js';
import { createCommercePrisma, type CommercePrisma } from '../infrastructure/prisma/client.js';
import {
  PrismaMovementReasonRepository, PrismaProductRepository, PrismaStockLedger, PrismaStockLocationRepository,
} from '../infrastructure/prisma/index.js';
import { FakeCoreAccess } from './fakes.js';

export const TEST_COMMERCE_DATABASE_URL = 'postgresql://commerce_app:test@127.0.0.1:55432/modivara_test?schema=commerce';

export const commercePrismaForTests = (): CommercePrisma => createCommercePrisma(TEST_COMMERCE_DATABASE_URL);

/** Deja el esquema commerce vacío entre pruebas (las migraciones ya están aplicadas por el globalSetup). */
export async function resetCommerce(prisma: CommercePrisma): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_events, stock_movements, stock_balances, movement_reasons, stock_locations, products CASCADE',
  );
}

/** Un negocio con un local (ids sin FK: viven en core). */
export const tenant = () => ({ organizationId: newId(), locationId: newId() });
export type TestTenant = ReturnType<typeof tenant>;

/** Casos de uso reales sobre PostgreSQL, con un local activo de `FakeCoreAccess`. */
export function integrationWorld(db: CommercePrisma, t: TestTenant = tenant()) {
  const core = new FakeCoreAccess();
  core.add({ id: t.locationId, organizationId: t.organizationId });
  const products = new PrismaProductRepository(db);
  const stockLocations = new PrismaStockLocationRepository(db);
  const reasons = new PrismaMovementReasonRepository(db);
  const ledger = new PrismaStockLedger(db);
  const recorder = new MovementRecorder(products, stockLocations, reasons, ledger, core);
  const actor = { ...t, actorUserId: newId() };
  return {
    t, actor, core, products, stockLocations, reasons, ledger,
    createProduct: new CreateProduct(products, core),
    registerMovement: new RegisterMovement(recorder),
    adjustToCount: new AdjustToCount(recorder),
    getBalances: new GetBalances(ledger, core),
    listMovements: new ListMovements(ledger, core),
    /** «Principal», motivos sembrados y un producto; devuelve ids y un buscador de motivos por nombre. */
    async seedBasics(productName = 'Cerveza') {
      const stockLocation = await new EnsureDefaultStockLocation(stockLocations, core).execute(actor);
      await new SeedMovementReasons(reasons).execute(actor);
      const product = await this.createProduct.execute({ ...actor, name: productName, unit: 'bottle' });
      const reason = async (name: string) => (await reasons.findActiveByName({ organizationId: t.organizationId, name }))!.id;
      return { stockLocation, product, reason };
    },
  };
}
