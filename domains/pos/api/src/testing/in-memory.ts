import type { CoreAccessPort, DomainEvent, LocationRef } from '@modivara/core-contracts';
import type {
  ExternalLink, ExternalReferenceValidator, IdempotencyKey, LocationScope, PosSettingsRepository, SaleStore, ScopedId, SellableItemRepository,
} from '../application/ports.js';
import { DEFAULT_CURRENCY } from '../application/use-cases.js';
import { ConflictError, IdempotencyKeyReusedError, NotFoundError } from '../domain/errors.js';
import { Sale } from '../domain/sale.js';
import { SellableItem } from '../domain/sellable-item.js';

const inScope = (p: LocationScope, q: LocationScope) => p.organizationId === q.organizationId && p.locationId === q.locationId;

export class InMemorySellableItems implements SellableItemRepository {
  readonly rows = new Map<string, ReturnType<SellableItem['toProps']>>();
  /** Igual que los índices únicos parciales: nombre (sin mayúsculas) y SKU únicos entre activos del local. */
  async save(item: SellableItem) {
    const p = item.toProps();
    const clash = p.deactivatedAt === null && [...this.rows.values()].some((r) =>
      r.id !== p.id && r.deactivatedAt === null && r.locationId === p.locationId &&
      (r.name.toLowerCase() === p.name.toLowerCase() || (p.sku !== null && r.sku === p.sku)));
    if (clash) throw new ConflictError('Unique violation');
    this.rows.set(item.id, p);
  }
  add(item: SellableItem) { return this.save(item); }
  async findById(q: ScopedId) {
    const p = this.rows.get(q.id);
    return p && inScope(p, q) ? SellableItem.restore(p) : null;
  }
  async list(q: LocationScope) {
    return [...this.rows.values()].filter((p) => inScope(p, q)).sort((a, b) => a.name.localeCompare(b.name)).map((p) => SellableItem.restore(p));
  }
  async findActiveByName(q: LocationScope & { name: string }) {
    return this.find((p) => inScope(p, q) && p.name.toLowerCase() === q.name.toLowerCase());
  }
  async findActiveBySku(q: LocationScope & { sku: string }) {
    return this.find((p) => inScope(p, q) && p.sku === q.sku);
  }
  private find(match: (p: ReturnType<SellableItem['toProps']>) => boolean) {
    const p = [...this.rows.values()].find((r) => r.deactivatedAt === null && match(r));
    return p ? SellableItem.restore(p) : null;
  }
}

/** Misma semántica que el adaptador de PostgreSQL: idempotencia, un vínculo activo por recurso, outbox. */
export class InMemorySales implements SaleStore {
  readonly rows = new Map<string, ReturnType<Sale['toProps']>>();
  /** Lo que el adaptador real escribe en `pos.outbox_events`. */
  readonly outbox: DomainEvent[] = [];
  readonly keys = new Map<string, IdempotencyKey & { saleId: string }>();
  readonly links: (ExternalLink & LocationScope & { saleId: string; active: boolean })[] = [];

  async open(sale: Sale, idem: IdempotencyKey | null, link?: ExternalLink) {
    const replay = idem && this.replay(sale, idem);
    if (replay) return replay;
    if (link) {
      const linked = await this.findByActiveLink({ organizationId: sale.organizationId, locationId: sale.locationId, ...link });
      if (linked) {
        if (idem) this.keys.set(`${sale.organizationId}:${idem.key}`, { ...idem, saleId: linked.id });
        return { sale: linked, replayed: true };
      }
      this.links.push({ ...link, organizationId: sale.organizationId, locationId: sale.locationId, saleId: sale.id, active: true });
    }
    this.write(sale, idem);
    return { sale: Sale.restore(sale.toProps()), replayed: false };
  }

  async mutate(q: ScopedId, idem: IdempotencyKey, work: (sale: Sale) => void) {
    const sale = await this.findById(q);
    if (!sale) throw new NotFoundError('Sale');
    const replay = this.replay(q, idem);
    if (replay) return replay;
    work(sale);
    this.write(sale, idem);
    if (sale.status !== 'open') for (const l of this.links) if (l.saleId === sale.id) l.active = false;
    return { sale: Sale.restore(sale.toProps()), replayed: false };
  }

  async findReplay(scope: LocationScope, idem: IdempotencyKey) {
    return this.replay(scope, idem);
  }

  async findById(q: ScopedId) {
    const p = this.rows.get(q.id);
    return p && inScope(p, q) ? Sale.restore(p) : null;
  }

  async findByActiveLink(q: LocationScope & ExternalLink) {
    const l = this.links.find((x) => x.active && inScope(x, q) && x.provider === q.provider && x.resourceType === q.resourceType && x.resourceId === q.resourceId);
    return l ? this.findById({ id: l.saleId, organizationId: q.organizationId, locationId: q.locationId }) : null;
  }

  async list(q: Parameters<SaleStore['list']>[0]) {
    const desc = (a: { openedAt: Date; id: string }, b: { openedAt: Date; id: string }) =>
      b.openedAt.getTime() - a.openedAt.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);
    return [...this.rows.values()]
      .filter((p) => inScope(p, q) && (!q.status || p.status === q.status) && (!q.after || desc(q.after, p) < 0))
      .sort(desc)
      .slice(0, q.limit)
      .map((p) => Sale.restore(p));
  }

  private replay(scope: LocationScope, idem: IdempotencyKey) {
    const k = this.keys.get(`${scope.organizationId}:${idem.key}`);
    if (!k) return null;
    const p = this.rows.get(k.saleId);
    if (k.operation !== idem.operation || k.fingerprint !== idem.fingerprint || !p || !inScope(p, scope)) {
      throw new IdempotencyKeyReusedError('Idempotency key reused');
    }
    return { sale: Sale.restore(p), replayed: true };
  }

  private write(sale: Sale, idem: IdempotencyKey | null) {
    this.rows.set(sale.id, sale.toProps());
    this.outbox.push(...sale.pullEvents());
    if (idem) this.keys.set(`${sale.organizationId}:${idem.key}`, { ...idem, saleId: sale.id });
  }
}

export class InMemoryPosSettings implements PosSettingsRepository {
  readonly rows = new Map<string, string>();
  constructor(private readonly items: InMemorySellableItems, private readonly sales: InMemorySales) {}
  async findCurrency(q: LocationScope) { return this.rows.get(`${q.organizationId}:${q.locationId}`) ?? null; }
  /** Sin await entre el chequeo y la escritura, así que es atómico (las altas en memoria no necesitan candado). */
  async changeCurrency(q: LocationScope & { currency: string }) {
    const current = (await this.findCurrency(q)) ?? DEFAULT_CURRENCY;
    if (current !== q.currency
      && ([...this.items.rows.values()].some((p) => inScope(p, q) && p.deactivatedAt === null && p.currency !== q.currency)
        || [...this.sales.rows.values()].some((p) => inScope(p, q) && p.status === 'open'))) return 'locked';
    this.rows.set(`${q.organizationId}:${q.locationId}`, q.currency);
    return 'ok';
  }
}

/** Proveedor externo de prueba: solo conoce los recursos de `known`; su etiqueta es `label` o `<tipo> <últimos 4 del id>`. */
export class FakeReferenceValidator implements ExternalReferenceValidator {
  readonly known = new Set<string>();
  label: string | null = null;
  constructor(readonly provider = 'ext') {}
  async validate(_ctx: unknown, resourceType: string, resourceId: string) {
    return this.known.has(`${resourceType}:${resourceId}`) ? (this.label ?? `${resourceType} ${resourceId.slice(-4)}`) : null;
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
