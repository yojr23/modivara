import { type CoreAccessPort, findActiveLocation, newId } from '@modivara/core-contracts';
import type { DeviceEventResult } from '@modivara/hospitality-contracts';
import { DeviceEvent } from '../domain/devices/device-event.js';
import { isDebounced } from '../domain/service-calls/debounce.js';
import { ServiceCall } from '../domain/service-calls/service-call.js';
import type {
  ButtonPressStore,
  DeviceAssignmentRepository,
  DeviceRepository,
  DiningTableRepository,
  IoTInputPort,
  NormalizedPress,
  NotificationPort,
  PressOutcome,
  ZoneRepository,
} from './ports/index.js';
import { notifyAfterSave, scopeOf } from './support.js';

/** Flujo de una pulsación (DATA-001 §3). Único método público: el de `IoTInputPort`. */
export class RegisterButtonPress implements IoTInputPort {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly devices: DeviceRepository,
    private readonly assignments: DeviceAssignmentRepository,
    private readonly tables: DiningTableRepository,
    private readonly zones: ZoneRepository,
    private readonly store: ButtonPressStore,
    private readonly notifications: NotificationPort,
  ) {}

  async registerPress(press: NormalizedPress): Promise<PressOutcome> {
    const now = new Date();
    // El id del evento se genera antes: la transición del llamado nuevo lo referencia.
    const eventId = newId();
    const correlationId = press.correlationId ?? newId();
    const deviceEvent = (result: DeviceEventResult, deviceId: string | null, serviceCallId: string | null) =>
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
      });
    const outcomeOf = (e: DeviceEvent): PressOutcome => ({ result: e.result, deviceEventId: e.id, serviceCallId: e.serviceCallId });
    const recordOnly = async (result: DeviceEventResult, deviceId: string | null) => {
      const event = deviceEvent(result, deviceId, null);
      await this.store.saveDeviceEvent(event);
      return outcomeOf(event);
    };

    const device = await this.devices.findActiveByCode({ ...scopeOf(press), code: press.deviceCode });
    if (!device) return recordOnly('unknown_device', null);

    // DATA-001 §1: el local debe existir, estar activo y ser del negocio del gateway antes de crear o reutilizar llamados.
    if (!(await findActiveLocation(this.core, press.organizationId, press.locationId))) return recordOnly('location_inactive', device.id);

    const assignment = await this.assignments.findActiveByDevice({ ...scopeOf(press), deviceId: device.id });
    const table = assignment ? await this.tables.findById({ ...scopeOf(press), id: assignment.tableId }) : null;
    if (!table?.isActive) return recordOnly('unassigned_device', device.id);

    const zone = table.zoneId ? await this.zones.findById({ ...scopeOf(press), id: table.zoneId }) : null;

    const { outcome, created, call } = await this.store.withDeviceLock(device.id, async (tx) => {
      const last = await tx.findLastPress({ ...scopeOf(press), deviceId: device.id, buttonKey: press.buttonKey });
      // OPEN: ¿la señal es solo el botón (DATA-001 §3 literal) o botón + tecla? Se usa botón + tecla.
      if (isDebounced(last?.receivedAt ?? null, now)) {
        const event = deviceEvent('debounced', device.id, null);
        await tx.saveDeviceEvent(event);
        return { outcome: outcomeOf(event), created: false, call: null };
      }
      const candidate = ServiceCall.create({
        organizationId: press.organizationId,
        locationId: press.locationId,
        table: { id: table.id, label: table.label, zoneId: table.zoneId, zoneName: zone?.name ?? null },
        callType: press.callType,
        deviceEventId: eventId,
        correlationId,
        now,
      });
      const upserted = await tx.upsertActiveCall(candidate, now);
      const event = deviceEvent(upserted.created ? 'call_created' : 'repeat_press', device.id, upserted.call.id);
      await tx.saveDeviceEvent(event);
      return { outcome: outcomeOf(event), created: upserted.created, call: upserted.call };
    });
    // El aviso va después de confirmar (DATA-001 §3 paso 4).
    if (call) await notifyAfterSave(this.notifications, created ? 'created' : 'repeat_press', call);
    return outcome;
  }
}
