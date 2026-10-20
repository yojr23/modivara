import type { CallType } from '@modivara/hospitality-contracts';
import type { Device } from '../../domain/devices/device.js';
import type { DeviceAssignment } from '../../domain/devices/device-assignment.js';
import type { DeviceEvent } from '../../domain/devices/device-event.js';
import type { Gateway } from '../../domain/devices/gateway.js';
import type { ServiceCall } from '../../domain/service-calls/service-call.js';
import type { DiningTable } from '../../domain/tables/dining-table.js';
import type { Zone } from '../../domain/tables/zone.js';

// Toda consulta lleva `locationId`: un local nunca ve filas de otro (DATA-001 §1).

export interface ServiceCallRepository {
  findById(id: string, locationId: string): Promise<ServiceCall | null>;
  /** Solicitud activa (pending/in_progress) de la mesa y tipo (ADR-002 D4). */
  findActive(tableId: string, callType: CallType): Promise<ServiceCall | null>;
  listActive(locationId: string): Promise<ServiceCall[]>;
  /**
   * Persiste en UNA transacción el agregado, sus transiciones y sus eventos en el outbox, y llama a `call.markPersisted()`.
   * Lanza `ConcurrencyConflictError` (con el estado actual) si el estado cambió desde que se leyó
   * (`call.persistedStatus`) o si ya existe otra solicitud activa para la mesa y tipo.
   */
  save(call: ServiceCall): Promise<void>;
}

export interface ZoneRepository {
  findById(id: string, locationId: string): Promise<Zone | null>;
  findActiveByName(locationId: string, name: string): Promise<Zone | null>;
  listByLocation(locationId: string): Promise<Zone[]>;
  save(zone: Zone): Promise<void>;
}

export interface DiningTableRepository {
  findById(id: string, locationId: string): Promise<DiningTable | null>;
  /** Etiqueta activa en la zona (o sin zona si `zoneId` es null), sin distinguir mayúsculas. */
  findActiveByLabel(locationId: string, zoneId: string | null, label: string): Promise<DiningTable | null>;
  listByLocation(locationId: string): Promise<DiningTable[]>;
  save(table: DiningTable): Promise<void>;
}

export interface DeviceRepository {
  findById(id: string, locationId: string): Promise<Device | null>;
  findActiveByCode(locationId: string, code: string): Promise<Device | null>;
  save(device: Device): Promise<void>;
}

export interface DeviceAssignmentRepository {
  findActiveByDevice(deviceId: string): Promise<DeviceAssignment | null>;
  listActiveByTable(tableId: string): Promise<DeviceAssignment[]>;
  save(assignment: DeviceAssignment): Promise<void>;
}

export interface GatewayRepository {
  findById(id: string): Promise<Gateway | null>;
  findByKeyHash(keyHash: string): Promise<Gateway | null>;
  listByLocation(locationId: string): Promise<Gateway[]>;
  save(gateway: Gateway): Promise<void>;
}

export interface DeviceEventRepository {
  /** Último evento contado (call_created/repeat_press) de la misma señal: botón + tecla. */
  findLastPress(deviceId: string, buttonKey: string | null): Promise<DeviceEvent | null>;
  listUnknown(locationId: string): Promise<DeviceEvent[]>;
  save(event: DeviceEvent): Promise<void>;
}
