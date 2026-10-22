import {
  inRange,
  latestPerPlaceAndProduct,
  type ServiceCallFact,
  type StockMovementFact,
} from '../domain/index.js';
import type {
  CoreAccessPort,
  LocationRef,
  ProcessedEventStore,
  ServiceCallFactQuery,
  ServiceCallFactRepository,
  StockMovementFactQuery,
  StockMovementFactRepository,
} from '../application/index.js';
import type { DateRange } from '../domain/index.js';

export class InMemoryServiceCallFactRepository implements ServiceCallFactRepository {
  readonly items = new Map<string, ServiceCallFact>();

  async findById(id: string) {
    return this.items.get(id) ?? null;
  }
  async save(fact: ServiceCallFact) {
    this.items.set(fact.serviceCallId, fact);
  }
  async findCreatedBetween(q: ServiceCallFactQuery) {
    return [...this.items.values()].filter((f) => {
      const s = f.snapshot;
      return (
        s.organizationId === q.organizationId &&
        s.locationId === q.locationId &&
        inRange(s.createdAt, q.range) &&
        (!q.zoneId || s.zoneId === q.zoneId) &&
        (!q.tableId || s.tableId === q.tableId)
      );
    });
  }
  async clear() {
    this.items.clear();
  }
}

export class InMemoryStockMovementFactRepository implements StockMovementFactRepository {
  readonly items = new Map<string, StockMovementFact>();

  async save(fact: StockMovementFact) {
    this.items.set(fact.movementId, fact);
  }
  private scoped(q: StockMovementFactQuery) {
    return [...this.items.values()].filter((f) => {
      const s = f.snapshot;
      return (
        s.organizationId === q.organizationId &&
        s.locationId === q.locationId &&
        (!q.productId || s.productId === q.productId) &&
        (!q.stockLocationId || s.stockLocationId === q.stockLocationId)
      );
    });
  }
  async findOccurredBetween(q: StockMovementFactQuery & { range: DateRange }) {
    return this.scoped(q).filter((f) => inRange(f.snapshot.occurredAt, q.range));
  }
  async findLatestPerPlaceAndProduct(q: StockMovementFactQuery) {
    return latestPerPlaceAndProduct(this.scoped(q));
  }
  async clear() {
    this.items.clear();
  }
}

export class InMemoryProcessedEventStore implements ProcessedEventStore {
  readonly ids = new Map<string, string>();

  async has(eventId: string) {
    return this.ids.has(eventId);
  }
  async add(eventId: string, eventType: string) {
    this.ids.set(eventId, eventType);
  }
  async clear() {
    this.ids.clear();
  }
}

export class InMemoryCoreAccess implements CoreAccessPort {
  async isModuleEnabled() { return true; }
  async authenticateSession() { return null; }
  async permissionsAt() { return null; }
  private readonly locations = new Map<string, LocationRef>();

  add(location: LocationRef): this {
    this.locations.set(location.id, location);
    return this;
  }
  async getLocation(locationId: string) {
    return this.locations.get(locationId) ?? null;
  }
}
