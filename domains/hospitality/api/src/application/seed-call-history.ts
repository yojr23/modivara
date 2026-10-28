import { type CoreAccessPort, civilDateIn, addDays, localTimeToUtc, newId, seededRandom } from '@modivara/core-contracts';
import { DeviceEvent } from '../domain/devices/device-event.js';
import { LocationUnavailableError } from '../domain/errors.js';
import { ServiceCall } from '../domain/service-calls/service-call.js';
import type {
  CallHistoryStore, DeviceAssignmentRepository, DeviceRepository, DiningTableRepository, GatewayRepository, ServiceCallRepository, ZoneRepository,
} from './ports/index.js';
import { type ActorContext, requireActiveLocation, scopeOf } from './support.js';

/**
 * Todos los números inventados del historial de demo, en un solo lugar. OPEN: son supuestos de la demo, no mediciones;
 * hay que reemplazarlos por lo medido en el piloto (PLAN-001 F6-13).
 */
export const DEMO_CALL_PROFILE = {
  seed: 20261027,
  /** [hora local, peso]: la demanda se concentra por la noche. */
  hourWeights: [[12, 1], [13, 2], [14, 1], [15, 1], [16, 1], [17, 2], [18, 4], [19, 6], [20, 8], [21, 9], [22, 8], [23, 4]] as ReadonlyArray<readonly [number, number]>,
  callsPerDay: 28,
  callsPerDayJitter: [-8, 12] as readonly [number, number],
  ackSeconds: [60, 240] as readonly [number, number],
  completionSeconds: [120, 360] as readonly [number, number],
  lateRate: 0.06,
  lateMinutes: [15, 40] as readonly [number, number],
  repeatRate: 0.2,
  repeatPresses: [1, 3] as readonly [number, number],
};
export type CallProfile = typeof DEMO_CALL_PROFILE;

/**
 * SOLO DEMO (F5-10): historial de llamados de los últimos `days` días que terminan ayer (hora local del local), con filas reales
 * (llamado, transiciones, señales del botón) y outbox v1 como si hubieran ocurrido. Determinista (PRNG con semilla) e idempotente:
 * si el local ya tiene llamados anteriores a hoy no hace nada. Devuelve cuántos llamados creó.
 */
export class SeedCallHistory {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly tables: DiningTableRepository,
    private readonly zones: ZoneRepository,
    private readonly devices: DeviceRepository,
    private readonly assignments: DeviceAssignmentRepository,
    private readonly gateways: GatewayRepository,
    private readonly calls: ServiceCallRepository,
    private readonly store: CallHistoryStore,
  ) {}

  async execute(ctx: ActorContext, options: { days?: number; now?: Date; profile?: CallProfile } = {}): Promise<number> {
    if (process.env.NODE_ENV === 'production') throw new Error('El historial de demo se niega a correr con NODE_ENV=production.');
    await requireActiveLocation(this.core, ctx);
    const location = await this.core.getLocation(ctx.locationId);
    if (!location) throw new LocationUnavailableError();
    const tz = location.timezone;
    const now = options.now ?? new Date();
    const today = civilDateIn(tz, now);
    const scope = scopeOf(ctx);

    if ((await this.calls.list(scope, { status: 'all', to: localTimeToUtc(tz, today), limit: 1 })).length > 0) return 0;

    const gateway = (await this.gateways.listByLocation(scope)).find((g) => g.isActive);
    if (!gateway) throw new Error('No hay gateway en el local: corre antes seed:hospitality.');
    const zoneNames = new Map((await this.zones.listByLocation(scope)).map((z) => [z.id, z.name]));
    const tableOf = new Map((await this.assignments.listActiveByLocation(scope)).map((a) => [a.deviceId, a.tableId]));
    const activeTables = new Map((await this.tables.listByLocation(scope)).filter((t) => t.isActive).map((t) => [t.id, t]));
    const buttons = (await this.devices.listActiveByLocation(scope)).flatMap((d) => {
      const table = activeTables.get(tableOf.get(d.id) ?? '');
      return table ? [{ device: d, table }] : [];
    });
    if (buttons.length === 0) throw new Error('No hay botones asignados a mesas: corre antes seed:hospitality.');

    const p = options.profile ?? DEMO_CALL_PROFILE;
    const totalWeight = p.hourWeights.reduce((s, [, w]) => s + w, 0);
    const rnd = seededRandom(p.seed);
    const between = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    const pickHour = () => {
      let r = rnd() * totalWeight;
      for (const [h, w] of p.hourWeights) if ((r -= w) < 0) return h;
      return 23;
    };
    const busyUntil = new Map<string, number>();
    let created = 0;

    for (let back = options.days ?? 14; back >= 1; back--) {
      const day = addDays(today, -back);
      const starts = Array.from({ length: p.callsPerDay + between(...p.callsPerDayJitter) }, () => localTimeToUtc(tz, day, pickHour(), between(0, 59), between(0, 59)));
      for (const start of starts.sort((a, b) => a.getTime() - b.getTime())) {
        const { device, table } = buttons[between(0, buttons.length - 1)]!;
        // Late = unas pocas quedan sin finalizar mucho rato (15–40 min); el resto: reconocida en 1–4 min y finalizada en 3–10 min en total.
        const ackAt = new Date(start.getTime() + between(...p.ackSeconds) * 1000);
        const late = rnd() < p.lateRate;
        const doneAt = new Date(ackAt.getTime() + (late ? between(p.lateMinutes[0] * 60, p.lateMinutes[1] * 60) : between(...p.completionSeconds)) * 1000);
        if (doneAt >= now || (busyUntil.get(table.id) ?? 0) > start.getTime()) continue;
        busyUntil.set(table.id, doneAt.getTime() + 60_000);

        const eventBase = { organizationId: ctx.organizationId, locationId: ctx.locationId, gatewayId: gateway.id, deviceId: device.id, deviceCode: device.code, buttonKey: null, transport: 'mqtt' as const, correlationId: newId() };
        const press = (at: Date, result: 'call_created' | 'repeat_press', id: string, serviceCallId: string | null) =>
          DeviceEvent.create({ ...eventBase, id, payload: { device_code: device.code, sent_at: at.toISOString() }, sentAt: at, receivedAt: at, result, serviceCallId });

        const firstEventId = newId(start.getTime());
        const call = ServiceCall.create({
          organizationId: ctx.organizationId, locationId: ctx.locationId,
          table: { id: table.id, label: table.label, zoneId: table.zoneId, zoneName: table.zoneId ? (zoneNames.get(table.zoneId) ?? null) : null },
          callType: 'attention', deviceEventId: firstEventId, correlationId: eventBase.correlationId, now: start,
        });
        const events = [press(start, 'call_created', firstEventId, call.id)];
        // Pulsaciones repetidas mientras esperaba (antes del reconocimiento, que es cuando viaja `press_count`).
        const repeats = rnd() < p.repeatRate ? between(...p.repeatPresses) : 0;
        for (let i = 1; i <= repeats; i++) {
          const at = new Date(start.getTime() + ((ackAt.getTime() - start.getTime()) * i) / (repeats + 1));
          call.registerPress(at);
          events.push(press(at, 'repeat_press', newId(at.getTime()), call.id));
        }
        call.acknowledge(ctx.actorUserId, ackAt, eventBase.correlationId);
        call.complete(ctx.actorUserId, doneAt, eventBase.correlationId);
        await this.store.save(call, events);
        created++;
      }
    }
    return created;
  }
}
