import type { INestApplicationContext } from '@nestjs/common';
import { BootstrapPlatform, ProvisionOrganization } from '@modivara/core-api';
import {
  AssignDevice, CreateGateway, CreateTable, CreateZone, GetConnectivity, GetLayoutDraft, ListDevices, ListTables, ListZones, PublishLayout, RegisterDevice, SaveLayoutDraft,
  type ActorContext,
} from '@modivara/hospitality-api';
import type { LayoutElement } from '@modivara/hospitality-contracts';
import { BUSINESSES, MODULES, SUPERADMIN } from './core.js';

// DATA-001 §7. OPEN: el documento no fija el formato de las etiquetas de mesa ("Mesa 1" como en el simulador) ni qué mesas hay en cada zona de
// "Bar Demo Pisos" (3 por zona, con los mismos números repetidos); tampoco el nombre del gateway.
const TABLES_IN_BAR_DEMO = 15;
const ZONES_IN_PISOS = ['Terraza', '2º piso'];
const TABLES_PER_ZONE = 3;
// OPEN: formato real de los códigos de dispositivo (depende del hardware); mismo valor por defecto que el simulador (apps/button-sim).
const buttonCode = (n: number) => `btn-${String(n).padStart(2, '0')}`;
const tableLabel = (n: number) => `Mesa ${n}`;
// ADR-003: plano de demo (lienzo 800×600; mesas de 60 en cuadrícula de `PLAN_COLUMNS` columnas, 120 de paso).
const PLAN_COLUMNS = 5;
const planElement = (type: 'bar' | 'door', x: number, y: number, width: number, height: number): LayoutElement => ({ id: crypto.randomUUID(), type, x, y, width, height, rotation: 0 });

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

  /** Publica un plano si el espacio aún no tiene uno publicado (idempotente); completa un borrador a medias si lo hay. */
  async function ensureLayout(ctx: ActorContext, zoneId: string | null, tableIds: string[], extras: LayoutElement[]): Promise<void> {
    const { draft, published } = await app.get(GetLayoutDraft).execute({ ...ctx, zoneId });
    if (published) return;
    const elements: LayoutElement[] = [
      ...extras,
      ...tableIds.map((tableId, i): LayoutElement => ({
        id: crypto.randomUUID(), type: 'table', table_id: tableId, shape: 'round',
        x: 100 + (i % PLAN_COLUMNS) * 120, y: 200 + Math.floor(i / PLAN_COLUMNS) * 120, width: 60, height: 60, rotation: 0,
      })),
    ];
    const saved = await app.get(SaveLayoutDraft).execute({ ...ctx, zoneId, revision: draft?.revision ?? 0, canvasWidth: 800, canvasHeight: 600, elements });
    await app.get(PublishLayout).execute({ ...ctx, zoneId, revision: saved.revision });
  }

  // Un gateway (clave impresa solo al crearlo) y un botón asignado por mesa; `prefix` distingue los códigos entre negocios.
  async function ensureButtons(ctx: ActorContext, prefix: string, tableIds: string[]): Promise<void> {
    if ((await app.get(GetConnectivity).execute(ctx)).gateways.length === 0) {
      const { gateway, plainKey } = await app.get(CreateGateway).execute({ ...ctx, name: 'Gateway demo' });
      printKey(`SIM_GATEWAY_KEY=${plainKey}   # gateway ${gateway.id}; no se vuelve a mostrar`);
    }
    const devices = await app.get(ListDevices).execute(ctx);
    for (const [i, tableId] of tableIds.entries()) {
      const code = prefix + buttonCode(i + 1);
      const existing = devices.find((d) => d.device.code === code);
      const device = existing?.device ?? (await app.get(RegisterDevice).execute({ ...ctx, code }));
      if (!existing?.tableId) await app.get(AssignDevice).execute({ ...ctx, deviceId: device.id, tableId });
    }
  }

  // Bar Demo: 15 mesas sin zonas, un gateway y 15 botones asignados.
  const demo = await contextOf('bar-demo');
  const tableIds: string[] = [];
  for (let n = 1; n <= TABLES_IN_BAR_DEMO; n++) tableIds.push(await ensureTable(demo, tableLabel(n), null));
  await ensureButtons(demo, '', tableIds);
  await ensureLayout(demo, null, tableIds, [planElement('bar', 100, 40, 600, 60), planElement('door', 20, 500, 80, 12)]);

  // Bar Demo Pisos: zonas con los mismos números de mesa repetidos en cada una; gateway y botones `p-btn-NN`.
  const pisos = await contextOf('bar-demo-pisos');
  const pisosTableIds: string[] = [];
  for (const zone of ZONES_IN_PISOS) {
    const zoneId = await ensureZone(pisos, zone);
    const zoneTableIds: string[] = [];
    for (let n = 1; n <= TABLES_PER_ZONE; n++) zoneTableIds.push(await ensureTable(pisos, tableLabel(n), zoneId));
    pisosTableIds.push(...zoneTableIds);
    await ensureLayout(pisos, zoneId, zoneTableIds, []);
  }
  await ensureButtons(pisos, 'p-', pisosTableIds);
}
