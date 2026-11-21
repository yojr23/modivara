import { CONTEXT_LABEL_MAX, type SaleStatus } from '@modivara/pos-contracts';
import { type CoreAccessPort, findActiveLocation, newId, type RequestActor } from '@modivara/core-contracts';
import { ConflictError, CurrencyLockedError, InvalidValueError, LocationUnavailableError, NotFoundError } from '../domain/errors.js';
import { Sale } from '../domain/sale.js';
import { type CreateSellableItemInput, SellableItem } from '../domain/sellable-item.js';
import { requireCurrency } from '../domain/values.js';
import type {
  ExternalReferenceValidator, IdempotencyKey, PosContext, PosSettingsRepository, SaleStore, SaleWrite, SellableItemRepository,
} from './ports.js';

// OPEN: moneda de un local sin ajustes guardados (POS-001 §7 dice COP); ¿derivarla del país del local cuando Core lo tenga?
export const DEFAULT_CURRENCY = 'COP';
export const DEFAULT_SALE_LIMIT = 50;
export const MAX_SALE_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireLocation(core: CoreAccessPort, ctx: PosContext): Promise<void> {
  if (!(await findActiveLocation(core, ctx.organizationId, ctx.locationId))) throw new LocationUnavailableError();
}

async function requireItem(items: SellableItemRepository, ctx: PosContext, id: string): Promise<SellableItem> {
  const item = await items.findById({ id, organizationId: ctx.organizationId, locationId: ctx.locationId });
  if (!item) throw new NotFoundError('Sellable item');
  return item;
}

async function locationCurrency(settings: PosSettingsRepository, ctx: PosContext): Promise<string> {
  return (await settings.findCurrency({ organizationId: ctx.organizationId, locationId: ctx.locationId })) ?? DEFAULT_CURRENCY;
}

/** Mensaje claro antes de escribir; la garantía la da `save` (índices únicos), no esta lectura. */
async function assertUnique(items: SellableItemRepository, item: SellableItem): Promise<void> {
  const scope = { organizationId: item.organizationId, locationId: item.locationId };
  const byName = await items.findActiveByName({ ...scope, name: item.name });
  if (byName && byName.id !== item.id) throw new ConflictError(`An active item named "${item.name}" already exists`);
  if (!item.sku) return;
  const bySku = await items.findActiveBySku({ ...scope, sku: item.sku });
  if (bySku && bySku.id !== item.id) throw new ConflictError(`An active item with SKU "${item.sku}" already exists`);
}

/**
 * Clave de idempotencia con la huella de la petición: el local y los datos de la operación, en orden fijo
 * (`JSON.stringify` respeta el orden de inserción). La misma clave en otro local u otra venta es otra petición.
 */
function idempotency(key: string, operation: string, ctx: PosContext, input: Record<string, string> = {}): IdempotencyKey {
  if (!UUID.test(key)) throw new InvalidValueError('Idempotency key must be a UUID');
  return { key, operation, fingerprint: JSON.stringify({ locationId: ctx.locationId, ...input }) };
}

const saleScope = (ctx: PosContext, id: string) => ({ id, organizationId: ctx.organizationId, locationId: ctx.locationId });

export type CreateSellableItemCommand = PosContext & Pick<CreateSellableItemInput, 'name' | 'sku' | 'category' | 'unit' | 'price'>;

/** La moneda del artículo es la del local (POS-09): el cliente no la envía. */
export class CreateSellableItem {
  constructor(
    private readonly items: SellableItemRepository,
    private readonly settings: PosSettingsRepository,
    private readonly core: CoreAccessPort,
  ) {}

  async execute(cmd: CreateSellableItemCommand): Promise<SellableItem> {
    await requireLocation(this.core, cmd);
    const currency = await locationCurrency(this.settings, cmd);
    const item = SellableItem.create({ ...cmd, currency, id: newId(), now: new Date() });
    await assertUnique(this.items, item);
    await this.items.save(item);
    return item;
  }
}

export class UpdateSellableItem {
  constructor(private readonly items: SellableItemRepository, private readonly core: CoreAccessPort) {}

  async execute(cmd: PosContext & { id: string; changes: Parameters<SellableItem['update']>[0] }): Promise<SellableItem> {
    await requireLocation(this.core, cmd);
    const item = await requireItem(this.items, cmd, cmd.id);
    item.update(cmd.changes, cmd.actorUserId, new Date());
    await assertUnique(this.items, item);
    await this.items.save(item);
    return item;
  }
}

export class DeactivateSellableItem {
  constructor(private readonly items: SellableItemRepository, private readonly core: CoreAccessPort) {}

  async execute(cmd: PosContext & { id: string }): Promise<void> {
    await requireLocation(this.core, cmd);
    const item = await requireItem(this.items, cmd, cmd.id);
    item.deactivate(cmd.actorUserId, new Date());
    await this.items.save(item);
  }
}

export class ListSellableItems {
  constructor(private readonly items: SellableItemRepository, private readonly core: CoreAccessPort) {}

  async execute(ctx: PosContext): Promise<SellableItem[]> {
    await requireLocation(this.core, ctx);
    return this.items.list({ organizationId: ctx.organizationId, locationId: ctx.locationId });
  }
}

export class GetPosSettings {
  constructor(private readonly settings: PosSettingsRepository, private readonly core: CoreAccessPort) {}

  async execute(ctx: PosContext): Promise<{ currency: string }> {
    await requireLocation(this.core, ctx);
    return { currency: await locationCurrency(this.settings, ctx) };
  }
}

/** Cambiar la moneda no toca artículos ni ventas ya creados: los nuevos toman la nueva y mezclarlas da `currency_mismatch`. */
export class UpdatePosSettings {
  constructor(
    private readonly settings: PosSettingsRepository,
    private readonly items: SellableItemRepository,
    private readonly sales: SaleStore,
    private readonly core: CoreAccessPort,
  ) {}

  /**
   * Una moneda por local, sin conversión: cambiarla con artículos activos en otra moneda o ventas abiertas → `currency_locked` (409).
   * Solo monedas de 2 decimales (el dinero se guarda en centésimas); no se valida contra la lista ISO, solo el formato de 3 letras.
   */
  async execute(cmd: PosContext & { currency: string }): Promise<{ currency: string }> {
    await requireLocation(this.core, cmd);
    const currency = requireCurrency(cmd.currency);
    const scope = { organizationId: cmd.organizationId, locationId: cmd.locationId };
    if ((await locationCurrency(this.settings, cmd)) !== currency
      && ((await this.items.countActiveOutsideCurrency({ ...scope, currency })) > 0 || (await this.sales.countOpen(scope)) > 0)) {
      throw new CurrencyLockedError('Currency cannot change while there are active items in another currency or open sales');
    }
    await this.settings.saveCurrency({ organizationId: cmd.organizationId, locationId: cmd.locationId, currency, actorUserId: cmd.actorUserId });
    return { currency };
  }
}

export class OpenSale {
  constructor(
    private readonly sales: SaleStore,
    private readonly settings: PosSettingsRepository,
    private readonly core: CoreAccessPort,
  ) {}

  async execute(cmd: PosContext & { idempotencyKey: string }): Promise<SaleWrite> {
    await requireLocation(this.core, cmd);
    const idem = idempotency(cmd.idempotencyKey, 'open_sale', cmd);
    const currency = await locationCurrency(this.settings, cmd);
    return this.sales.open(Sale.open({ ...cmd, currency, id: newId(), now: new Date() }), idem);
  }
}

/**
 * Abre o recupera la venta atada a un recurso de otro producto (POS-15). El validador del proveedor lo registra el host y da
 * la etiqueta del recurso, que la venta guarda como copia para mostrarla;
 * proveedor desconocido o recurso inválido → `NotFoundError` (no revela qué proveedores existen). La clave de idempotencia
 * queda atada a la venta devuelta (nueva o ya vinculada): un reintento tardío, aunque esa venta ya esté cerrada y el recurso
 * libre, devuelve la misma venta en vez de abrir otra.
 */
export class OpenLinkedSale {
  constructor(
    private readonly sales: SaleStore,
    private readonly settings: PosSettingsRepository,
    private readonly validators: readonly ExternalReferenceValidator[],
    private readonly core: CoreAccessPort,
  ) {}

  async execute(cmd: PosContext & { provider: string; resourceType: string; resourceId: string; idempotencyKey: string; actor?: RequestActor }): Promise<SaleWrite> {
    await requireLocation(this.core, cmd);
    const link = { provider: cmd.provider, resourceType: cmd.resourceType, resourceId: cmd.resourceId };
    const idem = idempotency(cmd.idempotencyKey, 'open_linked_sale', cmd, link);
    // Un reintento de una petición ya confirmada devuelve su venta aunque el recurso ya no valide (recurso desactivado, módulo del proveedor revocado).
    const replay = await this.sales.findReplay(cmd, idem);
    if (replay) return replay;
    const validator = this.validators.find((v) => v.provider === cmd.provider);
    const label = validator && UUID.test(cmd.resourceId) ? await validator.validate(cmd, cmd.resourceType, cmd.resourceId, cmd.actor) : null;
    if (label === null) throw new NotFoundError('External resource');
    const currency = await locationCurrency(this.settings, cmd);
    const contextLabel = label.trim().slice(0, CONTEXT_LABEL_MAX) || null;
    return this.sales.open(Sale.open({ ...cmd, currency, id: newId(), now: new Date(), contextLabel }), idem, link);
  }
}

export class GetSale {
  constructor(private readonly sales: SaleStore, private readonly core: CoreAccessPort) {}

  async execute(cmd: PosContext & { saleId: string }): Promise<Sale> {
    await requireLocation(this.core, cmd);
    const sale = await this.sales.findById(saleScope(cmd, cmd.saleId));
    if (!sale) throw new NotFoundError('Sale');
    return sale;
  }
}

export class ListSales {
  constructor(private readonly sales: SaleStore, private readonly core: CoreAccessPort) {}

  async execute(cmd: PosContext & { status?: SaleStatus; limit?: number; after?: { openedAt: Date; id: string } }): Promise<Sale[]> {
    await requireLocation(this.core, cmd);
    const limit = Math.min(Math.max(cmd.limit ?? DEFAULT_SALE_LIMIT, 1), MAX_SALE_LIMIT);
    return this.sales.list({ organizationId: cmd.organizationId, locationId: cmd.locationId, status: cmd.status, limit, after: cmd.after });
  }
}

export class AddSaleLine {
  constructor(
    private readonly sales: SaleStore,
    private readonly items: SellableItemRepository,
    private readonly core: CoreAccessPort,
  ) {}

  async execute(cmd: PosContext & { saleId: string; sellableItemId: string; quantity: string; idempotencyKey: string }): Promise<SaleWrite> {
    await requireLocation(this.core, cmd);
    const idem = idempotency(cmd.idempotencyKey, 'add_line', cmd, { saleId: cmd.saleId, itemId: cmd.sellableItemId, quantity: cmd.quantity });
    const item = await requireItem(this.items, cmd, cmd.sellableItemId);
    return this.sales.mutate(saleScope(cmd, cmd.saleId), idem, (sale) =>
      sale.addLine({ lineId: newId(), item, quantity: cmd.quantity, actorUserId: cmd.actorUserId, now: new Date() }),
    );
  }
}

export class VoidSaleLine {
  constructor(private readonly sales: SaleStore, private readonly core: CoreAccessPort) {}

  async execute(cmd: PosContext & { saleId: string; lineId: string; idempotencyKey: string }): Promise<SaleWrite> {
    await requireLocation(this.core, cmd);
    const idem = idempotency(cmd.idempotencyKey, 'void_line', cmd, { saleId: cmd.saleId, lineId: cmd.lineId });
    return this.sales.mutate(saleScope(cmd, cmd.saleId), idem, (sale) => sale.voidLine(cmd.lineId, cmd.actorUserId, new Date()));
  }
}

export class CompleteSale {
  constructor(private readonly sales: SaleStore, private readonly core: CoreAccessPort) {}

  async execute(cmd: PosContext & { saleId: string; paymentMethod: string; idempotencyKey: string }): Promise<SaleWrite> {
    await requireLocation(this.core, cmd);
    const idem = idempotency(cmd.idempotencyKey, 'complete_sale', cmd, { saleId: cmd.saleId, paymentMethod: cmd.paymentMethod });
    return this.sales.mutate(saleScope(cmd, cmd.saleId), idem, (sale) =>
      sale.complete({ eventId: newId(), paymentMethod: cmd.paymentMethod, actorUserId: cmd.actorUserId, now: new Date() }),
    );
  }
}

export class VoidSale {
  constructor(private readonly sales: SaleStore, private readonly core: CoreAccessPort) {}

  async execute(cmd: PosContext & { saleId: string; idempotencyKey: string }): Promise<SaleWrite> {
    await requireLocation(this.core, cmd);
    const idem = idempotency(cmd.idempotencyKey, 'void_sale', cmd, { saleId: cmd.saleId });
    return this.sales.mutate(saleScope(cmd, cmd.saleId), idem, (sale) => sale.void(cmd.actorUserId, new Date()));
  }
}
