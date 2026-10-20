import type { CoreAccessPort, LocationRef } from '@modivara/core-contracts';
import type { CallType } from '@modivara/hospitality-contracts';
import type {
  CallChange,
  DeviceAssignmentRepository,
  DeviceEventRepository,
  DeviceRepository,
  DiningTableRepository,
  GatewayRepository,
  NotificationPort,
  ServiceCallRepository,
  ZoneRepository,
} from '../application/ports/index.js';
import { Device } from '../domain/devices/device.js';
import { DeviceAssignment } from '../domain/devices/device-assignment.js';
import { DeviceEvent } from '../domain/devices/device-event.js';
import { Gateway } from '../domain/devices/gateway.js';
import type { DomainEvent } from '../domain/domain-event.js';
import { ConcurrencyConflictError } from '../domain/errors.js';
import { ServiceCall } from '../domain/service-calls/service-call.js';
import type { CallTransitionRecord } from '../domain/service-calls/transitions.js';
import { DiningTable } from '../domain/tables/dining-table.js';
import { Zone } from '../domain/tables/zone.js';


/** Guarda `toProps()` y rehidrata con `restore`, igual que lo haría una base de datos. */
class Store<T extends { id: string; toProps(): P }, P> {
  readonly rows = new Map<string, P>();
  constructor(private readonly restore: (p: P) => T) {}
  put(e: T) { this.rows.set(e.id, e.toProps()); }
  get(id: string): T | null { const p = this.rows.get(id); return p ? this.restore(p) : null; }
  all(): T[] { return [...this.rows.values()].map(this.restore); }
}

export class InMemoryServiceCallRepository implements ServiceCallRepository {
  private readonly store = new Store(ServiceCall.restore);
  readonly transitions: (CallTransitionRecord & { serviceCallId: string })[] = [];
  readonly outbox: DomainEvent[] = [];
  /** Para simular que otro usuario cambió la solicitud entre la lectura y el guardado. */
  beforeSave?: (call: ServiceCall) => Promise<void> | void;

  async findById(id: string, locationId: string) {
    const c = this.store.get(id);
    return c && c.locationId === locationId ? c : null;
  }
  async findActive(tableId: string, callType: CallType) {
    return this.store.all().find((c) => c.tableId === tableId && c.callType === callType && c.isActive) ?? null;
  }
  async listActive(locationId: string) {
    return this.store.all().filter((c) => c.locationId === locationId && c.isActive);
  }
  async save(call: ServiceCall) {
    await this.beforeSave?.(call);
    const stored = this.store.get(call.id);
    if (!stored) {
      const clash = await this.findActive(call.tableId, call.callType);
      if (clash && call.isActive) throw new ConcurrencyConflictError(clash);
    } else if (stored.status !== call.persistedStatus) {
      throw new ConcurrencyConflictError(stored);
    }
    this.store.put(call);
    this.transitions.push(...call.transitions.map((t) => ({ ...t, serviceCallId: call.id })));
    this.outbox.push(...call.events);
    call.markPersisted();
  }
  all() { return this.store.all(); }
}

export class InMemoryZoneRepository implements ZoneRepository {
  private readonly store = new Store(Zone.restore);
  async findById(id: string, locationId: string) { const z = this.store.get(id); return z && z.locationId === locationId ? z : null; }
  async findActiveByName(locationId: string, name: string) {
    return this.store.all().find((z) => z.locationId === locationId && z.isActive && z.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
  }
  async listByLocation(locationId: string) { return this.store.all().filter((z) => z.locationId === locationId); }
  async save(zone: Zone) { this.store.put(zone); }
}

export class InMemoryDiningTableRepository implements DiningTableRepository {
  private readonly store = new Store(DiningTable.restore);
  async findById(id: string, locationId: string) { const t = this.store.get(id); return t && t.locationId === locationId ? t : null; }
  async findActiveByLabel(locationId: string, zoneId: string | null, label: string) {
    return (
      this.store.all().find((t) => t.locationId === locationId && t.isActive && t.zoneId === zoneId && t.label.toLowerCase() === label.trim().toLowerCase()) ?? null
    );
  }
  async listByLocation(locationId: string) { return this.store.all().filter((t) => t.locationId === locationId); }
  async save(table: DiningTable) { this.store.put(table); }
}

export class InMemoryDeviceRepository implements DeviceRepository {
  private readonly store = new Store(Device.restore);
  async findById(id: string, locationId: string) { const d = this.store.get(id); return d && d.locationId === locationId ? d : null; }
  async findActiveByCode(locationId: string, code: string) {
    return this.store.all().find((d) => d.locationId === locationId && d.isActive && d.code === code) ?? null;
  }
  async save(device: Device) { this.store.put(device); }
}

export class InMemoryDeviceAssignmentRepository implements DeviceAssignmentRepository {
  private readonly store = new Store(DeviceAssignment.restore);
  async findActiveByDevice(deviceId: string) { return this.store.all().find((a) => a.deviceId === deviceId && a.isActive) ?? null; }
  async listActiveByTable(tableId: string) { return this.store.all().filter((a) => a.tableId === tableId && a.isActive); }
  async save(assignment: DeviceAssignment) { this.store.put(assignment); }
  history() { return this.store.all(); }
}

export class InMemoryGatewayRepository implements GatewayRepository {
  private readonly store = new Store(Gateway.restore);
  async findById(id: string) { return this.store.get(id); }
  async findByKeyHash(keyHash: string) { return this.store.all().find((g) => g.keyHash === keyHash) ?? null; }
  async listByLocation(locationId: string) { return this.store.all().filter((g) => g.locationId === locationId); }
  async save(gateway: Gateway) { this.store.put(gateway); }
}

export class InMemoryDeviceEventRepository implements DeviceEventRepository {
  private readonly store = new Store(DeviceEvent.restore);
  async findLastPress(deviceId: string, buttonKey: string | null) {
    const counted = this.store
      .all()
      .filter((e) => e.deviceId === deviceId && e.buttonKey === buttonKey && (e.result === 'call_created' || e.result === 'repeat_press'));
    return counted.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0] ?? null;
  }
  async listUnknown(locationId: string) { return this.store.all().filter((e) => e.locationId === locationId && e.result === 'unknown_device'); }
  async save(event: DeviceEvent) { this.store.put(event); }
  all() { return this.store.all(); }
}

export class RecordingNotifications implements NotificationPort {
  /** `persistedStatus` no nulo al avisar = el agregado ya estaba guardado. */
  readonly sent: { change: CallChange; callId: string; persistedStatus: string | null }[] = [];
  fail = false;
  async callChanged(change: CallChange, call: ServiceCall) {
    if (this.fail) throw new Error('socket down');
    this.sent.push({ change, callId: call.id, persistedStatus: call.persistedStatus });
  }
}

export class FakeCoreAccess implements CoreAccessPort {
  private readonly locations = new Map<string, LocationRef>();
  add(location: LocationRef) { this.locations.set(location.id, location); }
  async getLocation(id: string) { return this.locations.get(id) ?? null; }
}
