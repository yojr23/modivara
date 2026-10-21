import type { Device } from '../../domain/devices/device.js';
import type { DeviceAssignment } from '../../domain/devices/device-assignment.js';
import type { Gateway } from '../../domain/devices/gateway.js';
import type { ServiceCall } from '../../domain/service-calls/service-call.js';
import type { DiningTable } from '../../domain/tables/dining-table.js';
import type { Zone } from '../../domain/tables/zone.js';

/** Todo repositorio consulta acotado por negocio y local: un local nunca ve filas de otro (DATA-001 §1). */
export interface Scope {
  organizationId: string;
  locationId: string;
}

/** Búsqueda por id: el id solo no basta, siempre va con el tenant. */
export interface ById extends Scope {
  id: string;
}

export interface ServiceCallRepository {
  findById(key: ById): Promise<ServiceCall | null>;
  listActive(scope: Scope): Promise<ServiceCall[]>;
  /**
   * Persiste en UNA transacción el agregado, sus transiciones y sus eventos en el outbox, y llama a `call.pullEvents()`/`call.pullTransitions()`.
   * Lanza `ConcurrencyConflictError` (con el estado actual) si el estado cambió desde que se leyó
   * (`call.persistedStatus`) o si ya existe otra solicitud activa para la mesa y tipo.
   */
  save(call: ServiceCall): Promise<void>;
}

export interface ZoneRepository {
  findById(key: ById): Promise<Zone | null>;
  findActiveByName(query: Scope & { name: string }): Promise<Zone | null>;
  listByLocation(scope: Scope): Promise<Zone[]>;
  save(zone: Zone): Promise<void>;
}

export interface DiningTableRepository {
  findById(key: ById): Promise<DiningTable | null>;
  /** Etiqueta activa en la zona (o sin zona si `zoneId` es null), sin distinguir mayúsculas. */
  findActiveByLabel(query: Scope & { zoneId: string | null; label: string }): Promise<DiningTable | null>;
  listByLocation(scope: Scope): Promise<DiningTable[]>;
  save(table: DiningTable): Promise<void>;
}

export interface DeviceRepository {
  findById(key: ById): Promise<Device | null>;
  findActiveByCode(query: Scope & { code: string }): Promise<Device | null>;
  save(device: Device): Promise<void>;
}

export interface DeviceAssignmentRepository {
  findActiveByDevice(query: Scope & { deviceId: string }): Promise<DeviceAssignment | null>;
  listActiveByTable(query: Scope & { tableId: string }): Promise<DeviceAssignment[]>;
  /** ¿Qué mesa tenía el botón en el instante `at`? Incluye el instante de asignación y excluye el de cierre. Sirve para auditar pulsaciones pasadas. */
  findAt(query: Scope & { deviceId: string; at: Date }): Promise<DeviceAssignment | null>;
  /** Inserta o cierra una asignación. Lanza `DeviceAlreadyAssignedError` si el botón ya tiene otra activa. */
  save(assignment: DeviceAssignment): Promise<void>;
  /** Mueve un botón de mesa en UNA transacción: cierra `closed` (ya con `unassign`) y abre `opened`; si algo falla no cambia nada. El historial se conserva. */
  reassign(closed: DeviceAssignment, opened: DeviceAssignment): Promise<void>;
}

export interface GatewayRepository {
  findById(key: ById): Promise<Gateway | null>;
  /** Única consulta sin tenant: así se deriva el tenant de una pulsación (la clave identifica al gateway). */
  findByKeyHash(keyHash: string): Promise<Gateway | null>;
  listByLocation(scope: Scope): Promise<Gateway[]>;
  save(gateway: Gateway): Promise<void>;
}

/** Código no registrado, agregado sobre sus señales `unknown_device`. */
export interface UnknownDeviceCode {
  deviceCode: string;
  firstReceivedAt: Date;
  lastReceivedAt: Date;
  pressCount: number;
}

export interface DeviceEventRepository {
  /**
   * Códigos con señales `unknown_device` desde `since` que siguen sin dispositivo activo en el local.
   * El adaptador lo resuelve con un solo GROUP BY por código + NOT EXISTS contra `devices` (sin N+1).
   */
  listUnknownCodes(query: Scope & { since: Date }): Promise<UnknownDeviceCode[]>;
}
