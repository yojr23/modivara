import type { CoreAccessPort, DomainEvent, LocationRef } from '@modivara/core-contracts';
import type { CallType } from '@modivara/hospitality-contracts';
import type {
  ButtonPressStore,
  ButtonPressTx,
  CallChange,
  DeviceAssignmentRepository,
  DeviceEventRepository,
  DeviceRepository,
  DiningTableRepository,
  ById,
  GatewayRepository,
  NotificationPort,
  Scope,
  ServiceCallRepository,
  UnknownDeviceCode,
  ZoneRepository,
} from '../application/ports/index.js';
import { Device } from '../domain/devices/device.js';
import { DeviceAssignment } from '../domain/devices/device-assignment.js';
import { DeviceEvent } from '../domain/devices/device-event.js';
import { Gateway } from '../domain/devices/gateway.js';
import { ConcurrencyConflictError } from '../domain/errors.js';
import { ServiceCall } from '../domain/service-calls/service-call.js';
import type { CallTransitionRecord } from '../domain/service-calls/transitions.js';
import { DiningTable } from '../domain/tables/dining-table.js';
import { Zone } from '../domain/tables/zone.js';


const inScope = (e: Scope, s: Scope) => e.organizationId === s.organizationId && e.locationId === s.locationId;

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

  async findById({ id, ...scope }: ById) {
    const c = this.store.get(id);
    return c && inScope(c, scope) ? c : null;
  }
  async findActive({ tableId, callType, ...scope }: Scope & { tableId: string; callType: CallType }) {
    return this.store.all().find((c) => inScope(c, scope) && c.tableId === tableId && c.callType === callType && c.isActive) ?? null;
  }
  async listActive(scope: Scope) {
    return this.store.all().filter((c) => inScope(c, scope) && c.isActive);
  }
  /** `INSERT … ON CONFLICT … press_count + 1` síncrono (sin awaits): atómico en memoria. `undo` revierte para simular el rollback. */
  upsertActive(candidate: ServiceCall, now: Date) {
    const existing = this.store
      .all()
      .find((c) => inScope(c, candidate) && c.tableId === candidate.tableId && c.callType === candidate.callType && c.isActive);
    if (existing) {
      const before = existing.toProps();
      existing.registerPress(now);
      this.store.put(existing);
      return { call: existing, created: false, undo: () => void this.store.rows.set(before.id, before) };
    }
    this.store.put(candidate);
    const transitions = candidate.pullTransitions().map((t) => ({ ...t, serviceCallId: candidate.id }));
    const events = candidate.pullEvents();
    this.transitions.push(...transitions);
    this.outbox.push(...events);
    const undo = () => {
      this.store.rows.delete(candidate.id);
      for (const t of transitions) this.transitions.splice(this.transitions.indexOf(t), 1);
      for (const e of events) this.outbox.splice(this.outbox.indexOf(e), 1);
    };
    return { call: candidate, created: true, undo };
  }
  async save(call: ServiceCall) {
    await this.beforeSave?.(call);
    const stored = this.store.get(call.id);
    if (!stored) {
      const clash = await this.findActive({ organizationId: call.organizationId, locationId: call.locationId, tableId: call.tableId, callType: call.callType });
      if (clash && call.isActive) throw new ConcurrencyConflictError(clash);
    } else if (stored.status !== call.persistedStatus) {
      throw new ConcurrencyConflictError(stored);
    }
    this.store.put(call);
    this.transitions.push(...call.pullTransitions().map((t) => ({ ...t, serviceCallId: call.id })));
    this.outbox.push(...call.pullEvents());
  }
  all() { return this.store.all(); }
}

export class InMemoryZoneRepository implements ZoneRepository {
  private readonly store = new Store(Zone.restore);
  async findById({ id, ...scope }: ById) { const z = this.store.get(id); return z && inScope(z, scope) ? z : null; }
  async findActiveByName({ name, ...scope }: Scope & { name: string }) {
    return this.store.all().find((z) => inScope(z, scope) && z.isActive && z.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
  }
  async listByLocation(scope: Scope) { return this.store.all().filter((z) => inScope(z, scope)); }
  async save(zone: Zone) { this.store.put(zone); }
}

export class InMemoryDiningTableRepository implements DiningTableRepository {
  private readonly store = new Store(DiningTable.restore);
  async findById({ id, ...scope }: ById) { const t = this.store.get(id); return t && inScope(t, scope) ? t : null; }
  async findActiveByLabel({ zoneId, label, ...scope }: Scope & { zoneId: string | null; label: string }) {
    return (
      this.store.all().find((t) => inScope(t, scope) && t.isActive && t.zoneId === zoneId && t.label.toLowerCase() === label.trim().toLowerCase()) ?? null
    );
  }
  async listByLocation(scope: Scope) { return this.store.all().filter((t) => inScope(t, scope)); }
  async save(table: DiningTable) { this.store.put(table); }
}

export class InMemoryDeviceRepository implements DeviceRepository {
  private readonly store = new Store(Device.restore);
  async findById({ id, ...scope }: ById) { const d = this.store.get(id); return d && inScope(d, scope) ? d : null; }
  async findActiveByCode({ code, ...scope }: Scope & { code: string }) {
    return this.store.all().find((d) => inScope(d, scope) && d.isActive && d.code === code) ?? null;
  }
  async save(device: Device) { this.store.put(device); }
}

export class InMemoryDeviceAssignmentRepository implements DeviceAssignmentRepository {
  private readonly store = new Store(DeviceAssignment.restore);
  async findActiveByDevice({ deviceId, ...scope }: Scope & { deviceId: string }) { return this.store.all().find((a) => inScope(a, scope) && a.deviceId === deviceId && a.isActive) ?? null; }
  async listActiveByTable({ tableId, ...scope }: Scope & { tableId: string }) { return this.store.all().filter((a) => inScope(a, scope) && a.tableId === tableId && a.isActive); }
  async findAt({ deviceId, at, ...scope }: Scope & { deviceId: string; at: Date }) {
    return (
      this.store.all().find((a) => inScope(a, scope) && a.deviceId === deviceId && a.assignedAt <= at && (a.unassignedAt === null || a.unassignedAt > at)) ?? null
    );
  }
  async save(assignment: DeviceAssignment) { this.store.put(assignment); }
  async reassign(closed: DeviceAssignment, opened: DeviceAssignment) { this.store.put(closed); this.store.put(opened); }
  history() { return this.store.all(); }
}

export class InMemoryGatewayRepository implements GatewayRepository {
  private readonly store = new Store(Gateway.restore);
  async findById({ id, ...scope }: ById) { const g = this.store.get(id); return g && inScope(g, scope) ? g : null; }
  async findByKeyHash(keyHash: string) { return this.store.all().find((g) => g.keyHash === keyHash) ?? null; }
  async listByLocation(scope: Scope) { return this.store.all().filter((g) => inScope(g, scope)); }
  async save(gateway: Gateway) { this.store.put(gateway); }
}

export class InMemoryDeviceEventRepository implements DeviceEventRepository {
  private readonly store = new Store(DeviceEvent.restore);
  lastPress({ deviceId, buttonKey, ...scope }: Scope & { deviceId: string; buttonKey: string | null }) {
    const counted = this.store
      .all()
      .filter((e) => inScope(e, scope) && e.deviceId === deviceId && e.buttonKey === buttonKey && (e.result === 'call_created' || e.result === 'repeat_press'));
    return counted.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0] ?? null;
  }
  constructor(private readonly devices: InMemoryDeviceRepository) {}

  async listUnknownCodes({ since, ...scope }: Scope & { since: Date }) {
    const byCode = new Map<string, UnknownDeviceCode>();
    for (const e of this.store.all()) {
      if (!inScope(e, scope) || e.result !== 'unknown_device' || e.receivedAt < since) continue;
      const seen = byCode.get(e.deviceCode);
      if (!seen) byCode.set(e.deviceCode, { deviceCode: e.deviceCode, firstReceivedAt: e.receivedAt, lastReceivedAt: e.receivedAt, pressCount: 1 });
      else {
        seen.pressCount += 1;
        if (e.receivedAt < seen.firstReceivedAt) seen.firstReceivedAt = e.receivedAt;
        if (e.receivedAt > seen.lastReceivedAt) seen.lastReceivedAt = e.receivedAt;
      }
    }
    const result: UnknownDeviceCode[] = [];
    for (const unknown of byCode.values()) {
      if (!(await this.devices.findActiveByCode({ ...scope, code: unknown.deviceCode }))) result.push(unknown);
    }
    return result;
  }
  /** Devuelve el `undo` para el rollback de la transacción simulada. */
  add(event: DeviceEvent) {
    this.store.put(event);
    return () => void this.store.rows.delete(event.id);
  }
  all() { return this.store.all(); }
}

/** Doble de `ButtonPressStore`: serializa por dispositivo y deshace todo si el trabajo falla (rollback). */
export class InMemoryButtonPressStore implements ButtonPressStore {
  private readonly locks = new Map<string, Promise<void>>();
  /** Fallos inyectables para probar que no queda nada a medias. */
  fail: { upsert?: Error; saveEvent?: Error } = {};

  constructor(
    private readonly calls: InMemoryServiceCallRepository,
    private readonly events: InMemoryDeviceEventRepository,
  ) {}

  async saveDeviceEvent(event: DeviceEvent) {
    this.events.add(event);
  }

  async withDeviceLock<T>(deviceId: string, work: (tx: ButtonPressTx) => Promise<T>): Promise<T> {
    const previous = this.locks.get(deviceId) ?? Promise.resolve();
    let release!: () => void;
    this.locks.set(deviceId, previous.then(() => new Promise<void>((resolve) => (release = resolve))));
    await previous;
    const undo: (() => void)[] = [];
    const tx: ButtonPressTx = {
      findLastPress: async (query) => this.events.lastPress(query),
      upsertActiveCall: async (candidate, now) => {
        if (this.fail.upsert) throw this.fail.upsert;
        const { undo: revert, ...result } = this.calls.upsertActive(candidate, now);
        undo.push(revert);
        return result;
      },
      saveDeviceEvent: async (event) => {
        if (this.fail.saveEvent) throw this.fail.saveEvent;
        undo.push(this.events.add(event));
      },
    };
    try {
      return await work(tx);
    } catch (error) {
      for (const revert of undo.reverse()) revert();
      throw error;
    } finally {
      release();
    }
  }
}

export class RecordingNotifications implements NotificationPort {
  /** `saved`: el llamado ya existía en el repositorio al avisar (el aviso va después de guardar). */
  readonly sent: { change: CallChange; callId: string; saved: boolean }[] = [];
  fail = false;
  constructor(private readonly isSaved: (callId: string) => boolean = () => true) {}
  async callChanged(change: CallChange, call: ServiceCall) {
    if (this.fail) throw new Error('socket down');
    this.sent.push({ change, callId: call.id, saved: this.isSaved(call.id) });
  }
}

export class FakeCoreAccess implements CoreAccessPort {
  private readonly locations = new Map<string, LocationRef>();
  add(location: LocationRef) { this.locations.set(location.id, location); }
  async getLocation(id: string) { return this.locations.get(id) ?? null; }
}
