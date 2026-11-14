import type { CoreAccessPort, DomainEvent, LocationRef } from '@modivara/core-contracts';
import type { SaleRepository, ScopedId, SellableItemRepository } from '../application/ports.js';
import { Sale } from '../domain/sale.js';
import { SellableItem } from '../domain/sellable-item.js';

const inScope = (p: { organizationId: string; locationId: string }, q: { organizationId: string; locationId: string }) =>
  p.organizationId === q.organizationId && p.locationId === q.locationId;

export class InMemorySellableItems implements SellableItemRepository {
  readonly rows = new Map<string, ReturnType<SellableItem['toProps']>>();
  async save(item: SellableItem) { this.rows.set(item.id, item.toProps()); }
  async findById(q: ScopedId) {
    const p = this.rows.get(q.id);
    return p && inScope(p, q) ? SellableItem.restore(p) : null;
  }
  async findActiveByName(q: { organizationId: string; locationId: string; name: string }) {
    return this.find((p) => inScope(p, q) && p.name.toLowerCase() === q.name.toLowerCase());
  }
  async findActiveBySku(q: { organizationId: string; locationId: string; sku: string }) {
    return this.find((p) => inScope(p, q) && p.sku === q.sku);
  }
  private find(match: (p: ReturnType<SellableItem['toProps']>) => boolean) {
    const p = [...this.rows.values()].find((r) => r.deactivatedAt === null && match(r));
    return p ? SellableItem.restore(p) : null;
  }
}

export class InMemorySales implements SaleRepository {
  readonly rows = new Map<string, ReturnType<Sale['toProps']>>();
  /** Lo que el adaptador real escribe en `pos.outbox_events`. */
  readonly outbox: DomainEvent[] = [];
  async save(sale: Sale) {
    this.rows.set(sale.id, sale.toProps());
    this.outbox.push(...sale.pullEvents());
  }
  async findById(q: ScopedId) {
    const p = this.rows.get(q.id);
    return p && inScope(p, q) ? Sale.restore(p) : null;
  }
}

/** Core mínimo: solo locales. POS no necesita nada más de Core para vender. */
export class FakeCore implements CoreAccessPort {
  readonly locations = new Map<string, LocationRef>();
  add(ref: Pick<LocationRef, 'id' | 'organizationId'> & Partial<LocationRef>) {
    this.locations.set(ref.id, { timezone: 'America/Bogota', active: true, ...ref });
  }
  async getLocation(id: string) { return this.locations.get(id) ?? null; }
  async isModuleEnabled() { return true; }
  async authenticateSession() { return null; }
  async permissionsAt() { return null; }
  async userDisplayNames() { return new Map<string, string>(); }
}
