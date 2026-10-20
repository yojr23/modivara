import { type CoreAccessPort, findActiveLocation, newId } from '@modivara/core-contracts';
import type { DeviceEventResult } from '@modivara/hospitality-contracts';
import { DeviceEvent } from '../domain/devices/device-event.js';
import { ConcurrencyConflictError } from '../domain/errors.js';
import { isDebounced } from '../domain/service-calls/debounce.js';
import { ServiceCall } from '../domain/service-calls/service-call.js';
import type {
  DeviceAssignmentRepository,
  DeviceEventRepository,
  DeviceRepository,
  DiningTableRepository,
  IoTInputPort,
  NormalizedPress,
  NotificationPort,
  PressOutcome,
  ServiceCallRepository,
  ZoneRepository,
} from './ports/index.js';
import { notifyAfterSave, scopeOf } from './support.js';

const MAX_ATTEMPTS = 3;

/** Flujo de una pulsación (DATA-001 §3). */
export class RegisterButtonPress implements IoTInputPort {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly devices: DeviceRepository,
    private readonly assignments: DeviceAssignmentRepository,
    private readonly tables: DiningTableRepository,
    private readonly zones: ZoneRepository,
    private readonly calls: ServiceCallRepository,
    private readonly events: DeviceEventRepository,
    private readonly notifications: NotificationPort,
  ) {}

  async registerPress(press: NormalizedPress): Promise<PressOutcome> {
    return this.execute(press);
  }

  async execute(press: NormalizedPress): Promise<PressOutcome> {
    const now = new Date();
    const eventId = newId();
    const correlationId = press.correlationId ?? newId();
    const record = async (result: DeviceEventResult, deviceId: string | null, serviceCallId: string | null) => {
      await this.events.save(
        DeviceEvent.create({
          id: eventId,
          organizationId: press.organizationId,
          locationId: press.locationId,
          gatewayId: press.gatewayId,
          deviceId,
          deviceCode: press.deviceCode,
          buttonKey: press.buttonKey,
          transport: press.transport,
          payload: press.payload,
          sentAt: press.sentAt,
          receivedAt: now,
          result,
          serviceCallId,
          correlationId,
        }),
      );
      return { result, deviceEventId: eventId, serviceCallId };
    };

    const device = await this.devices.findActiveByCode({ ...scopeOf(press), code: press.deviceCode });
    if (!device) return record('unknown_device', null, null);

    // DATA-001 §1: el local debe existir, estar activo y ser del negocio del gateway antes de crear o reutilizar llamados.
    // OPEN: DATA-001 §3 no tiene un resultado para "local inactivo"; se usa unassigned_device (el más conservador: sin llamado).
    const location = await findActiveLocation(this.core, press.organizationId, press.locationId);
    if (!location) return record('unassigned_device', device.id, null);

    const assignment = await this.assignments.findActiveByDevice({ ...scopeOf(press), deviceId: device.id });
    const table = assignment ? await this.tables.findById({ ...scopeOf(press), id: assignment.tableId }) : null;
    if (!table?.isActive) return record('unassigned_device', device.id, null);

    const last = await this.events.findLastPress({ ...scopeOf(press), deviceId: device.id, buttonKey: press.buttonKey });
    // OPEN: ¿la señal es solo el botón (DATA-001 §3 literal) o botón + tecla? Se usa botón + tecla.
    if (isDebounced(last?.receivedAt ?? null, now)) return record('debounced', device.id, null);

    const zone = table.zoneId ? await this.zones.findById({ ...scopeOf(press), id: table.zoneId }) : null;

    // ponytail: la base resuelve la carrera con el upsert atómico (DATA-001 §3); aquí se reintenta ante conflicto.
    for (let attempt = 1; ; attempt++) {
      const active = await this.calls.findActive({ ...scopeOf(press), tableId: table.id, callType: press.callType });
      const created = !active;
      const call =
        active ??
        ServiceCall.create({
          organizationId: press.organizationId,
          locationId: press.locationId,
          table: { id: table.id, label: table.label, zoneId: table.zoneId, zoneName: zone?.name ?? null },
          callType: press.callType,
          deviceEventId: eventId,
          correlationId,
          now,
        });
      if (!created) call.registerPress(now);
      try {
        await this.calls.save(call);
      } catch (error) {
        if (error instanceof ConcurrencyConflictError && attempt < MAX_ATTEMPTS) continue;
        throw error;
      }
      const outcome = await record(created ? 'call_created' : 'repeat_press', device.id, call.id);
      // El aviso va después de guardar (DATA-001 §3 paso 4).
      await notifyAfterSave(this.notifications, created ? 'created' : 'repeat_press', call);
      return outcome;
    }
  }
}
