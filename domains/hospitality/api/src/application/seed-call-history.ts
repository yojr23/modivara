import { type CoreAccessPort, civilDateIn, addDays, localTimeToUtc, newId, seededRandom } from '@modivara/core-contracts';
import { DeviceEvent } from '../domain/devices/device-event.js';
import { LocationUnavailableError } from '../domain/errors.js';
import { ServiceCall } from '../domain/service-calls/service-call.js';
import type {
  CallHistoryStore, DeviceAssignmentRepository, DeviceRepository, DiningTableRepository, GatewayRepository, ServiceCallRepository, ZoneRepository,
} from './ports/index.js';
import { type ActorContext, requireActiveLocation, scopeOf } from './support.js';

// Horas locales de la ventana con su peso: la demanda se concentra por la noche (OPEN: curva inventada para la demo).
const HOUR_WEIGHTS: ReadonlyArray<readonly [number, number]> = [[12, 1], [13, 2], [14, 1], [15, 1], [16, 1], [17, 2], [18, 4], [19, 6], [20, 8], [21, 9], [22, 8], [23, 4]];
const TOTAL_WEIGHT = HOUR_WEIGHTS.reduce((s, [, w]) => s + w, 0);
const CALLS_PER_DAY = 28;
const SEED = 20261027;

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

  async execute(ctx: ActorContext, options: { days?: number; now?: Date } = {}): Promise<number> {
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

    const rnd = seededRandom(SEED);
    const between = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    const pickHour = () => {
      let r = rnd() * TOTAL_WEIGHT;
      for (const [h, w] of HOUR_WEIGHTS) if ((r -= w) < 0) return h;
      return 23;
    };
    const busyUntil = new Map<string, number>();
    let created = 0;

    for (let back = options.days ?? 14; back >= 1; back--) {
      const day = addDays(today, -back);
      const starts = Array.from({ length: CALLS_PER_DAY + between(-8, 12) }, () => localTimeToUtc(tz, day, pickHour(), between(0, 59), between(0, 59)));
      for (const start of starts.sort((a, b) => a.getTime() - b.getTime())) {
        const { device, table } = buttons[between(0, buttons.length - 1)]!;
        // Late = unas pocas quedan sin finalizar mucho rato (15–40 min); el resto: reconocida en 1–4 min y finalizada en 3–10 min en total.
        const ackAt = new Date(start.getTime() + between(60, 240) * 1000);
        const late = rnd() < 0.06;
        const doneAt = new Date(ackAt.getTime() + (late ? between(15 * 60, 40 * 60) : between(120, 360)) * 1000);
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
        const repeats = rnd() < 0.2 ? between(1, 3) : 0;
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
