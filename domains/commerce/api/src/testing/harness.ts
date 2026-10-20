import {
  AdjustToCount,
  CreateMovementReason,
  CreateProduct,
  CreateStockLocation,
  DeactivateMovementReason,
  DeactivateProduct,
  EnsureDefaultStockLocation,
  GetBalances,
  ListMovements,
  MovementRecorder,
  RegisterMovement,
  SeedMovementReasons,
  UpdateProduct,
} from '../application/index.js';
import { FakeCoreAccess, FixedClock, SequentialIds } from './fakes.js';
import { InMemoryMovementReasonRepository, InMemoryProductRepository, InMemoryStockLocationRepository } from './in-memory-repositories.js';
import { InMemoryStockLedger } from './in-memory-stock-ledger.js';

/** Todo el módulo cableado con dobles en memoria, para pruebas de casos de uso. */
export function createHarness() {
  const products = new InMemoryProductRepository();
  const stockLocations = new InMemoryStockLocationRepository();
  const reasons = new InMemoryMovementReasonRepository();
  const ledger = new InMemoryStockLedger();
  const core = new FakeCoreAccess();
  const ids = new SequentialIds();
  const clock = new FixedClock();
  const recorder = new MovementRecorder(products, stockLocations, reasons, ledger, core, ids, clock);
  return {
    products, stockLocations, reasons, ledger, core, ids, clock,
    createProduct: new CreateProduct(products, ids, clock),
    updateProduct: new UpdateProduct(products, clock),
    deactivateProduct: new DeactivateProduct(products, clock),
    ensureDefaultStockLocation: new EnsureDefaultStockLocation(stockLocations, core, ids, clock),
    createStockLocation: new CreateStockLocation(stockLocations, core, ids, clock),
    seedMovementReasons: new SeedMovementReasons(reasons, ids, clock),
    createMovementReason: new CreateMovementReason(reasons, ids, clock),
    deactivateMovementReason: new DeactivateMovementReason(reasons, clock),
    registerMovement: new RegisterMovement(recorder),
    adjustToCount: new AdjustToCount(recorder),
    getBalances: new GetBalances(ledger),
    listMovements: new ListMovements(ledger),
  };
}
