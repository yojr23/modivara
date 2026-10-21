import type { INestApplicationContext } from '@nestjs/common';
import { BootstrapPlatform, ProvisionOrganization } from '@modivara/core-api';
import {
  AssignDevice, CreateGateway, CreateTable, CreateZone, GetConnectivity, ListDevices, ListTables, ListZones, RegisterDevice, type ActorContext,
} from '@modivara/hospitality-api';
import { BUSINESSES, MODULES, SUPERADMIN } from './core.js';

// DATA-001 §7. OPEN: el documento no fija el formato de las etiquetas de mesa ("Mesa 1" como en el simulador) ni qué mesas hay en cada zona de
// "Bar Demo Pisos" (3 por zona, con los mismos números repetidos); tampoco el nombre del gateway.
const TABLES_IN_BAR_DEMO = 15;
const ZONES_IN_PISOS = ['Terraza', '2º piso'];
const TABLES_PER_ZONE = 3;
// OPEN: formato real de los códigos de dispositivo (depende del hardware); mismo valor por defecto que el simulador (apps/button-sim).
const buttonCode = (n: number) => `btn-${String(n).padStart(2, '0')}`;
const tableLabel = (n: number) => `Mesa ${n}`;

/**
 * Solo casos de uso públicos de core y hospitality; idempotente (lo que ya existe no se toca ni se duplica).
 * `printKey` recibe la clave del gateway UNA vez, solo cuando el seed lo crea: después no hay forma de recuperarla.
 * Requiere haber corrido `seed:core` (usa el mismo superadmin; `password` solo se usa si aún no existe).
 */
export async function seedHospitality(app: INestApplicationContext, password: string, printKey: (line: string) => void): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:hospitality se niega a correr con NODE_ENV=production: es solo para datos de demo.');
  }
  const root = await app.get(BootstrapPlatform).execute({ ...SUPERADMIN, password });
  const provision = app.get(ProvisionOrganization);

  async function contextOf(slug: string): Promise<ActorContext> {
    const b = BUSINESSES.find((x) => x.slug === slug)!;
    const { organization, locations } = await provision.execute({ actor: root, slug, name: b.name, locations: [{ name: b.location }], modules: MODULES });
    return { organizationId: organization.id, locationId: locations[0]!.id, actorUserId: root.actorUserId };
  }

  async function ensureZone(ctx: ActorContext, name: string): Promise<string> {
    const existing = (await app.get(ListZones).execute(ctx)).find((z) => z.name === name);
    return (existing ?? (await app.get(CreateZone).execute({ ...ctx, name }))).id;
  }

  async function ensureTable(ctx: ActorContext, label: string, zoneId: string | null): Promise<string> {
    const existing = (await app.get(ListTables).execute(ctx)).find((v) => v.table.label === label && v.table.zoneId === zoneId);
    return (existing?.table ?? (await app.get(CreateTable).execute({ ...ctx, label, zoneId }))).id;
  }

  // Bar Demo: 15 mesas sin zonas, un gateway y 15 botones asignados.
  const demo = await contextOf('bar-demo');
  const tableIds: string[] = [];
  for (let n = 1; n <= TABLES_IN_BAR_DEMO; n++) tableIds.push(await ensureTable(demo, tableLabel(n), null));

  if ((await app.get(GetConnectivity).execute(demo)).gateways.length === 0) {
    const { gateway, plainKey } = await app.get(CreateGateway).execute({ ...demo, name: 'Gateway demo' });
    printKey(`SIM_GATEWAY_KEY=${plainKey}   # gateway ${gateway.id}; no se vuelve a mostrar`);
  }

  const devices = await app.get(ListDevices).execute(demo);
  for (let n = 1; n <= TABLES_IN_BAR_DEMO; n++) {
    const code = buttonCode(n);
    const existing = devices.find((d) => d.device.code === code);
    const device = existing?.device ?? (await app.get(RegisterDevice).execute({ ...demo, code }));
    if (!existing?.tableId) await app.get(AssignDevice).execute({ ...demo, deviceId: device.id, tableId: tableIds[n - 1]! });
  }

  // Bar Demo Pisos: zonas con los mismos números de mesa repetidos en cada una.
  const pisos = await contextOf('bar-demo-pisos');
  for (const zone of ZONES_IN_PISOS) {
    const zoneId = await ensureZone(pisos, zone);
    for (let n = 1; n <= TABLES_PER_ZONE; n++) await ensureTable(pisos, tableLabel(n), zoneId);
  }
}
