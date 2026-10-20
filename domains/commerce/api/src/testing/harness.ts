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
import { FakeCoreAccess } from './fakes.js';
import { InMemoryMovementReasonRepository, InMemoryProductRepository, InMemoryStockLocationRepository } from './in-memory-repositories.js';
import { InMemoryStockLedger } from './in-memory-stock-ledger.js';

/** Todo el módulo cableado con dobles en memoria, para pruebas de casos de uso. */
export function createHarness() {
  const products = new InMemoryProductRepository();
  const stockLocations = new InMemoryStockLocationRepository();
  const reasons = new InMemoryMovementReasonRepository();
  const ledger = new InMemoryStockLedger();
  const core = new FakeCoreAccess();
  const recorder = new MovementRecorder(products, stockLocations, reasons, ledger, core);
  return {
    products, stockLocations, reasons, ledger, core,
    createProduct: new CreateProduct(products),
    updateProduct: new UpdateProduct(products),
    deactivateProduct: new DeactivateProduct(products),
    ensureDefaultStockLocation: new EnsureDefaultStockLocation(stockLocations, core),
    createStockLocation: new CreateStockLocation(stockLocations, core),
    seedMovementReasons: new SeedMovementReasons(reasons),
    createMovementReason: new CreateMovementReason(reasons),
    deactivateMovementReason: new DeactivateMovementReason(reasons),
    registerMovement: new RegisterMovement(recorder),
    adjustToCount: new AdjustToCount(recorder),
    getBalances: new GetBalances(ledger, core),
    listMovements: new ListMovements(ledger, core),
  };
}
