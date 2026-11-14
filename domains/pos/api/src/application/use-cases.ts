import { type CoreAccessPort, findActiveLocation, newId } from '@modivara/core-contracts';
import { ConflictError, LocationUnavailableError, NotFoundError } from '../domain/errors.js';
import { Sale } from '../domain/sale.js';
import { type CreateSellableItemInput, SellableItem } from '../domain/sellable-item.js';
import type { SaleRepository, SellableItemRepository } from './ports.js';

/** Quién, en qué negocio y en qué local; viene del contexto autorizado en el servidor, nunca del cliente. */
export interface PosContext {
  organizationId: string;
  locationId: string;
  actorUserId: string;
}

async function requireLocation(core: CoreAccessPort, ctx: PosContext): Promise<void> {
  if (!(await findActiveLocation(core, ctx.organizationId, ctx.locationId))) throw new LocationUnavailableError();
}

async function requireItem(items: SellableItemRepository, ctx: PosContext, id: string): Promise<SellableItem> {
  const item = await items.findById({ id, organizationId: ctx.organizationId, locationId: ctx.locationId });
  if (!item) throw new NotFoundError('Sellable item');
  return item;
}

async function requireSale(sales: SaleRepository, ctx: PosContext, id: string): Promise<Sale> {
  const sale = await sales.findById({ id, organizationId: ctx.organizationId, locationId: ctx.locationId });
  if (!sale) throw new NotFoundError('Sale');
  return sale;
}

async function assertUnique(items: SellableItemRepository, item: SellableItem): Promise<void> {
  const scope = { organizationId: item.organizationId, locationId: item.locationId };
  const byName = await items.findActiveByName({ ...scope, name: item.name });
  if (byName && byName.id !== item.id) throw new ConflictError(`An active item named "${item.name}" already exists`);
  if (!item.sku) return;
  const bySku = await items.findActiveBySku({ ...scope, sku: item.sku });
  if (bySku && bySku.id !== item.id) throw new ConflictError(`An active item with SKU "${item.sku}" already exists`);
}

export type CreateSellableItemCommand = PosContext &
  Pick<CreateSellableItemInput, 'name' | 'sku' | 'category' | 'unit' | 'price' | 'currency'>;

export class CreateSellableItem {
  constructor(private readonly items: SellableItemRepository, private readonly core: CoreAccessPort) {}

  async execute(cmd: CreateSellableItemCommand): Promise<SellableItem> {
    await requireLocation(this.core, cmd);
    const item = SellableItem.create({ ...cmd, id: newId(), now: new Date() });
    await assertUnique(this.items, item);
    await this.items.save(item);
    return item;
  }
}

export class UpdateSellableItem {
  constructor(private readonly items: SellableItemRepository) {}

  async execute(cmd: PosContext & { id: string; changes: Parameters<SellableItem['update']>[0] }): Promise<SellableItem> {
    const item = await requireItem(this.items, cmd, cmd.id);
    item.update(cmd.changes, cmd.actorUserId, new Date());
    await assertUnique(this.items, item);
    await this.items.save(item);
    return item;
  }
}

export class DeactivateSellableItem {
  constructor(private readonly items: SellableItemRepository) {}

  async execute(cmd: PosContext & { id: string }): Promise<void> {
    const item = await requireItem(this.items, cmd, cmd.id);
    item.deactivate(cmd.actorUserId, new Date());
    await this.items.save(item);
  }
}

// OPEN: la moneda de la venta llega en el comando; con POS-09 saldrá de la configuración del local.
export class OpenSale {
  constructor(private readonly sales: SaleRepository, private readonly core: CoreAccessPort) {}

  async execute(cmd: PosContext & { currency: string }): Promise<Sale> {
    await requireLocation(this.core, cmd);
    const sale = Sale.open({ ...cmd, id: newId(), now: new Date() });
    await this.sales.save(sale);
    return sale;
  }
}

export class AddSaleLine {
  constructor(private readonly sales: SaleRepository, private readonly items: SellableItemRepository) {}

  async execute(cmd: PosContext & { saleId: string; sellableItemId: string; quantity: string }): Promise<Sale> {
    const sale = await requireSale(this.sales, cmd, cmd.saleId);
    const item = await requireItem(this.items, cmd, cmd.sellableItemId);
    sale.addLine({ lineId: newId(), item, quantity: cmd.quantity, actorUserId: cmd.actorUserId, now: new Date() });
    await this.sales.save(sale);
    return sale;
  }
}

export class VoidSaleLine {
  constructor(private readonly sales: SaleRepository) {}

  async execute(cmd: PosContext & { saleId: string; lineId: string }): Promise<Sale> {
    const sale = await requireSale(this.sales, cmd, cmd.saleId);
    sale.voidLine(cmd.lineId, cmd.actorUserId, new Date());
    await this.sales.save(sale);
    return sale;
  }
}

export class CompleteSale {
  constructor(private readonly sales: SaleRepository) {}

  async execute(cmd: PosContext & { saleId: string; paymentMethod: string }): Promise<Sale> {
    const sale = await requireSale(this.sales, cmd, cmd.saleId);
    sale.complete({ eventId: newId(), paymentMethod: cmd.paymentMethod, actorUserId: cmd.actorUserId, now: new Date() });
    await this.sales.save(sale);
    return sale;
  }
}

export class VoidSale {
  constructor(private readonly sales: SaleRepository) {}

  async execute(cmd: PosContext & { saleId: string }): Promise<Sale> {
    const sale = await requireSale(this.sales, cmd, cmd.saleId);
    sale.void(cmd.actorUserId, new Date());
    await this.sales.save(sale);
    return sale;
  }
}
