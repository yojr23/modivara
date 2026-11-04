import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ANALYTICS_API_PATHS as AN } from '@modivara/analytics-contracts';
import { COMMERCE_API_PATHS as CM } from '@modivara/commerce-contracts';
import {
  CORE_API_PATHS as CO, IS_PUBLIC_KEY, permissionsFor, REQUIRED_PERMISSION_KEY, SESSION_COOKIE, type LocationRole, type MeResponse, type Permission,
} from '@modivara/core-contracts';
import {
  CALLS_API_PATHS as CA, GATEWAY_API_PATHS, GATEWAY_KEY_HEADER, HOSPITALITY_API_PATHS as HO, LAYOUTS_API_PATHS as LA, REALTIME_EVENTS as E, REALTIME_PATH,
} from '@modivara/hospitality-contracts';
import { PASSWORD, startHost } from './testing.js';

// SEC-07 + QA-06: matriz negativa rol × endpoint × negocio/local. Solo caminos de rechazo (el camino feliz ya lo cubren las demás suites).
// Códigos esperados, leídos de los guards reales de core: Origin -> Sesión -> Permiso -> Módulo, y DomainExceptionFilter:
//   sin sesión / cookie inventada / vencida / revocada -> 401; permiso que falta en un local propio -> 403 (permission_denied);
//   local de otro negocio -> 404 (ResolveLocationAccess: indistinguible de uno inexistente), también si el rol no tiene el permiso;
//   Origin ajeno en una mutación -> 403.

type Method = 'get' | 'post' | 'put' | 'patch';
type Host = Awaited<ReturnType<typeof startHost>>;
interface Route { method: Method; path: string; permission: Permission | null }

const r = (method: Method, path: string, permission: Permission | null): Route => ({ method, path, permission });
const ROUTES: Route[] = [
  r('get', CO.me, null),
  r('get', CO.users, 'core.users.manage'),
  r('post', CO.users, 'core.users.manage'),
  r('post', CO.userPasswordReset, 'core.users.manage'),
  r('post', CO.userDeactivate, 'core.users.manage'),
  r('post', CO.userRevokeSessions, 'core.users.manage'),
  r('put', CO.userLocationRoles, 'core.users.manage'),
  r('get', CO.platformOrganizations, 'platform.organizations.manage'),
  r('put', CO.actingOrganization, 'platform.organizations.manage'),
  r('get', CA.serviceCalls, 'hospitality.calls.read'),
  r('get', CA.serviceCall, 'hospitality.calls.read'),
  r('post', CA.acknowledge, 'hospitality.calls.acknowledge'),
  r('post', CA.complete, 'hospitality.calls.complete'),
  r('get', HO.zones, 'hospitality.calls.read'),
  r('post', HO.zones, 'hospitality.tables.manage'),
  r('patch', HO.zone, 'hospitality.tables.manage'),
  r('post', HO.zoneDeactivate, 'hospitality.tables.manage'),
  r('get', HO.tables, 'hospitality.calls.read'),
  r('post', HO.tables, 'hospitality.tables.manage'),
  r('patch', HO.table, 'hospitality.tables.manage'),
  r('post', HO.tableDeactivate, 'hospitality.tables.manage'),
  r('get', HO.deviceStatus, 'hospitality.devices.status'),
  r('get', LA.layouts, 'hospitality.calls.read'),
  r('get', LA.layoutDraft, 'hospitality.tables.manage'),
  r('put', LA.layoutDraft, 'hospitality.tables.manage'),
  r('post', LA.layoutPublish, 'hospitality.tables.manage'),
  r('post', HO.platformGateways, 'platform.gateways.manage'),
  r('get', HO.platformGateways, 'platform.gateways.manage'),
  r('post', HO.platformGatewayDeactivate, 'platform.gateways.manage'),
  r('post', HO.platformDevices, 'platform.devices.manage'),
  r('get', HO.platformDevices, 'platform.devices.manage'),
  r('get', HO.platformUnknownDevices, 'platform.devices.manage'),
  r('post', HO.platformAssignDevice, 'platform.device_assignments.manage'),
  r('post', HO.platformUnassignDevice, 'platform.device_assignments.manage'),
  r('get', AN.serviceCallMetrics, 'analytics.calls.read'),
  r('get', AN.inventoryMetrics, 'analytics.inventory.read'),
  r('get', CM.products, 'commerce.stock.read'),
  r('post', CM.products, 'commerce.catalog.manage'),
  r('patch', CM.product, 'commerce.catalog.manage'),
  r('post', CM.productDeactivate, 'commerce.catalog.manage'),
  r('get', CM.stockLocations, 'commerce.stock.read'),
  r('post', CM.stockLocations, 'commerce.catalog.manage'),
  r('get', CM.balances, 'commerce.stock.read'),
  r('get', CM.movements, 'commerce.stock.read'),
  r('post', CM.movements, 'commerce.stock.write'),
  r('post', CM.countAdjustments, 'commerce.stock.write'),
  r('get', CM.reasons, 'commerce.stock.read'),
  r('post', CM.reasons, 'commerce.reasons.manage'),
  r('post', CM.reasonDeactivate, 'commerce.reasons.manage'),
];
// Rutas sin sesión de usuario. Las del gateway se autentican con su clave; /health vive en AppModule y lo cubre health.int.test.ts.
const PUBLIC_ROUTES = new Set(['post /auth/login', 'post /auth/logout', `post ${GATEWAY_API_PATHS.deviceEvents}`, `post ${GATEWAY_API_PATHS.heartbeat}`]);

const ZERO = '00000000-0000-4000-8000-000000000000';
const ROLES = ['admin', 'staff', 'inventory'] as const satisfies readonly LocationRole[];
const USER_OF: Record<(typeof ROLES)[number], [string, string]> = { admin: ['bar-demo', 'admin'], staff: ['bar-demo', 'barra'], inventory: ['bar-demo', 'inventario1'] };
const hasPermission = (role: LocationRole, p: Permission) => permissionsFor([role], { isOwner: false, isPlatform: false }).has(p);
const fill = (path: string, locationId: string) => path.replace(':locationId', locationId).replace(/:\w+/g, ZERO);
const hasLocation = (route: Route) => route.path.includes(':locationId');
const label = (route: Route) => `${route.method.toUpperCase()} ${route.path}`;

let h: Host;
let server: ReturnType<Host['app']['getHttpServer']>;
let origin: string;
const cookies = new Map<string, string>();
const sockets: ClientSocket[] = [];
let demoLocation: string, pisosLocation: string;
let pisos: { table: string; zone: string; product: string; reason: string; device: string; call: string; gatewayKey: string };
let demoTable: string;

async function login(slug: string, username: string, key = `${slug}/${username}`) {
  const res = await request(server).post('/api/v1/auth/login').send({ slug, username, password: PASSWORD });
  expect(res.status).toBe(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
  cookies.set(key, cookie);
  return cookie;
}
const call = (cookie: string | undefined, method: Method, path: string, body?: object, headers: Record<string, string> = {}) => {
  let req = request(server)[method](`/api/v1${path}`);
  if (cookie) req = req.set('Cookie', cookie);
  req = req.set(headers);
  return method === 'get' ? req : req.send(body ?? {});
};
const withBody = (route: Route) => (route.method === 'get' ? undefined : {});

beforeAll(async () => {
  h = await startHost();
  server = h.app.getHttpServer();
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const [slug, user] of [...Object.values(USER_OF), ['bar-demo-pisos', 'admin']] as [string, string][]) await login(slug, user);
  const meOf = async (who: string) => (await call(cookies.get(who), 'get', '/me')).body as MeResponse;
  demoLocation = h.locationId;
  const pisosMe = await meOf('bar-demo-pisos/admin');
  pisosLocation = pisosMe.locations[0]!.id;
  expect(pisosLocation).not.toBe(demoLocation);

  // Recursos reales del otro negocio (bar-demo-pisos) para probar ids ajenos bajo un local propio.
  const sa = h.as('labs/superadmin');
  const padmin = (method: 'post', path: string, body: object) => call(cookies.get('bar-demo-pisos/admin'), method, path, body);
  await sa.put('/platform/acting-organization', { organization_id: pisosMe.organization!.id });
  const gateway = (await sa.post(`/platform/locations/${pisosLocation}/gateways`, { name: 'GW-P' })).body as { key: string };
  const device = (await sa.post(`/platform/locations/${pisosLocation}/devices`, { code: 'btn-p1' })).body as { id: string };
  const table = (await padmin('post', `/locations/${pisosLocation}/tables`, { label: 'P1' })).body as { id: string };
  const zone = (await padmin('post', `/locations/${pisosLocation}/zones`, { name: 'Terraza P' })).body as { id: string };
  const product = (await padmin('post', `/locations/${pisosLocation}/products`, { name: 'Ron P', unit: 'bottle' })).body as { id: string };
  const reason = (await padmin('post', '/commerce/movement-reasons', { name: 'Compra P', direction: 'in' })).body as { id: string };
  await sa.post(`/platform/locations/${pisosLocation}/devices/${device.id}/assign`, { table_id: table.id });
  await sa.put('/platform/acting-organization', { organization_id: h.organizationId });
  const press = await request(server).post(`/api/v1${GATEWAY_API_PATHS.deviceEvents}`).set(GATEWAY_KEY_HEADER, gateway.key).send({ device_code: 'btn-p1' });
  pisos = { table: table.id, zone: zone.id, product: product.id, reason: reason.id, device: device.id, call: press.body.service_call_id, gatewayKey: gateway.key };
  for (const id of Object.values(pisos)) expect(typeof id).toBe('string');
  await login('labs', 'superadmin', 'labs/superadmin-sin-negocio');
  const acting = await login('labs', 'superadmin', 'labs/superadmin-bar-demo');
  expect((await call(acting, 'put', '/platform/acting-organization', { organization_id: h.organizationId })).status).toBe(200);
  demoTable = ((await call(cookies.get('bar-demo/admin'), 'post', `/locations/${demoLocation}/tables`, { label: 'D-X' })).body as { id: string }).id;
});
afterEach(() => { for (const s of sockets.splice(0)) s.disconnect(); });
afterAll(() => h.app.close());

describe('la matriz cubre todas las rutas reales', () => {
  // Evita que una ruta nueva (o un permiso cambiado) quede fuera de la matriz sin que nadie lo decida.
  const discovered = () => {
    const out: Array<{ key: string; publicRoute: boolean; permission: Permission | null }> = [];
    for (const mod of h.app.get(ModulesContainer).values()) {
      for (const { metatype } of mod.controllers.values()) {
        if (!metatype) continue;
        const prefix = Reflect.getMetadata('path', metatype) as string | string[];
        for (const name of Object.getOwnPropertyNames(metatype.prototype)) {
          const handler = (metatype.prototype as Record<string, unknown>)[name];
          if (typeof handler !== 'function') continue;
          const verb = Reflect.getMetadata('method', handler) as number | undefined;
          if (verb === undefined) continue;
          const meta = <T>(k: string) => (Reflect.getMetadata(k, handler) ?? Reflect.getMetadata(k, metatype)) as T | undefined;
          const method = ['get', 'post', 'put', 'delete', 'patch'][verb] as string;
          for (const p of [Reflect.getMetadata('path', handler)].flat() as string[]) {
            for (const pre of [prefix].flat()) {
              const path = `/${pre}/${p}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
              out.push({ key: `${method} ${path}`, publicRoute: meta<boolean>(IS_PUBLIC_KEY) === true, permission: meta<Permission>(REQUIRED_PERMISSION_KEY) ?? null });
            }
          }
        }
      }
    }
    return out;
  };

  it('toda ruta con sesión está en la tabla con su permiso; toda ruta pública está declarada', () => {
    const found = discovered();
    expect(found.filter((f) => f.publicRoute).map((f) => f.key).sort()).toEqual([...PUBLIC_ROUTES].sort());
    const guarded = found.filter((f) => !f.publicRoute).map((f) => `${f.key} ${f.permission}`).sort();
    expect(guarded).toEqual(ROUTES.map((x) => `${x.method} ${x.path} ${x.permission}`).sort());
  });
});

describe('anónimo, cookie inventada, vencida o revocada -> 401 en toda ruta con sesión', () => {
  it.each(ROUTES.map((x) => [label(x), x] as const))('%s sin cookie', async (_n, route) => {
    expect((await call(undefined, route.method, fill(route.path, demoLocation), withBody(route))).status).toBe(401);
  });

  it.each(ROUTES.map((x) => [label(x), x] as const))('%s con cookie inventada', async (_n, route) => {
    expect((await call(`${SESSION_COOKIE}=inventada`, route.method, fill(route.path, demoLocation), withBody(route))).status).toBe(401);
  });

  it('sesión vencida o cerrada: 401 en /me y en una ruta por local', async () => {
    const expired = await login('bar-demo', 'mesero1', 'expired');
    const closed = await login('bar-demo', 'mesero1', 'closed');
    expect((await call(expired, 'get', `/locations/${demoLocation}/service-calls`)).status).toBe(200); // control: antes de vencer, sirve
    await h.get<{ $executeRawUnsafe(sql: string): Promise<unknown> }>('CORE_PRISMA').$executeRawUnsafe(
      `UPDATE core.sessions SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM core.app_users WHERE username = 'mesero1')`,
    );
    for (const cookie of [expired, closed]) {
      expect((await call(cookie, 'get', '/me')).status).toBe(401);
      expect((await call(cookie, 'get', `/locations/${demoLocation}/service-calls`)).status).toBe(401);
    }
    const fresh = await login('bar-demo', 'mesero1', 'fresh');
    expect((await call(fresh, 'post', '/auth/logout')).status).toBe(204);
    expect((await call(fresh, 'get', '/me')).status).toBe(401);
  });
});

describe('rol sin el permiso, en su propio local -> 403', () => {
  const cases = ROLES.flatMap((role) =>
    ROUTES.filter((x) => x.permission && !hasPermission(role, x.permission)).map((x) => [`${role} ${label(x)}`, role, x] as const));

  it.each(cases)('%s', async (_n, role, route) => {
    const res = await call(cookies.get(USER_OF[role].join('/')), route.method, fill(route.path, demoLocation), withBody(route));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'permission_denied' });
  });

  it('la matriz generada no está vacía (staff e inventory dejan fuera rutas de admin y de plataforma)', () => {
    expect(cases.length).toBeGreaterThan(80);
  });
});

describe('local de otro negocio -> 404, sea cual sea el rol y tenga o no el permiso', () => {
  const locationRoutes = ROUTES.filter(hasLocation);
  const fromDemo = ROLES.flatMap((role) => locationRoutes.map((x) => [`${role} de bar-demo ${label(x)}`, USER_OF[role].join('/'), pisosLocation, x] as const));
  const fromPisos = locationRoutes.map((x) => [`admin de bar-demo-pisos ${label(x)}`, 'bar-demo-pisos/admin', demoLocation, x] as const);

  it.each([...fromDemo, ...fromPisos])('%s', async (_n, who, foreignLocation, route) => {
    const res = await call(cookies.get(who), route.method, fill(route.path, foreignLocation), withBody(route));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(foreignLocation);
  });
});

describe('superadmin sin acceso al local: nunca 2xx', () => {
  // El superadmin pasa los guards de permiso (ADR-002 D3), así que el aislamiento lo decide el caso de uso con el negocio efectivo.
  // 404 si llega a validar el local; 400 si el cuerpo/query vacío falla antes. Lo que no puede ser es 2xx ni 5xx.
  const locationRoutes = ROUTES.filter(hasLocation);

  it.each(locationRoutes.map((x) => [label(x), x] as const))('operando sobre bar-demo, local de bar-demo-pisos: %s', async (_n, route) => {
    const res = await call(cookies.get('labs/superadmin-bar-demo'), route.method, fill(route.path, pisosLocation), withBody(route));
    expect([400, 404]).toContain(res.status);
  });

  it.each(locationRoutes.map((x) => [label(x), x] as const))('sin negocio elegido: %s', async (_n, route) => {
    const res = await call(cookies.get('labs/superadmin-sin-negocio'), route.method, fill(route.path, demoLocation), withBody(route));
    expect([400, 404]).toContain(res.status);
  });
});

describe('ids de otro negocio bajo un local propio -> 404', () => {
  const admin = () => cookies.get('bar-demo/admin');
  const base = () => `/locations/${demoLocation}`;

  it.each([
    ['PATCH mesa ajena', 'patch', (b: string) => `${b}/tables/${pisos.table}`, { label: 'zz' }],
    ['POST desactivar mesa ajena', 'post', (b: string) => `${b}/tables/${pisos.table}/deactivate`, {}],
    ['POST mesa en zona ajena', 'post', (b: string) => `${b}/tables`, { label: 'Z1', zone_id: pisos.zone }],
    ['PATCH zona ajena', 'patch', (b: string) => `${b}/zones/${pisos.zone}`, { name: 'zz' }],
    ['POST desactivar zona ajena', 'post', (b: string) => `${b}/zones/${pisos.zone}/deactivate`, {}],
    ['PATCH producto ajeno', 'patch', (b: string) => `${b}/products/${pisos.product}`, { name: 'zz' }],
    ['POST desactivar producto ajeno', 'post', (b: string) => `${b}/products/${pisos.product}/deactivate`, {}],
    ['GET llamado ajeno', 'get', (b: string) => `${b}/service-calls/${pisos.call}`, undefined],
    ['POST reconocer llamado ajeno', 'post', (b: string) => `${b}/service-calls/${pisos.call}/acknowledge`, {}],
    ['POST finalizar llamado ajeno', 'post', (b: string) => `${b}/service-calls/${pisos.call}/complete`, {}],
    ['POST desactivar motivo ajeno', 'post', () => `/commerce/movement-reasons/${pisos.reason}/deactivate`, {}],
  ] as const)('admin de bar-demo: %s', async (_n, method, path, body) => {
    expect((await call(admin(), method, path(base()), body)).status).toBe(404);
  });

  it.each([
    ['asignar botón ajeno a una mesa propia', `/platform/locations/${'DEMO'}/devices/${'DEVICE'}/assign`, { table_id: 'TABLE' }],
    ['desasignar botón ajeno', `/platform/locations/${'DEMO'}/devices/${'DEVICE'}/unassign`, {}],
  ] as const)('superadmin operando sobre bar-demo: %s', async (_n, template, body) => {
    const path = template.replace('DEMO', demoLocation).replace('DEVICE', pisos.device);
    const res = await h.as('labs/superadmin').post(path, JSON.parse(JSON.stringify(body).replace('TABLE', demoTable)));
    expect(res.status).toBe(404);
  });
});

describe('Origin ajeno en una mutación con sesión válida -> 403', () => {
  it.each(ROUTES.filter((x) => x.method !== 'get').map((x) => [label(x), x] as const))('%s', async (_n, route) => {
    const res = await call(cookies.get('bar-demo/admin'), route.method, fill(route.path, demoLocation), {}, { Origin: 'https://malo.example' });
    expect(res.status).toBe(403);
  });
});

describe('rutas del gateway: solo la clave del gateway, no la sesión', () => {
  const paths = [GATEWAY_API_PATHS.deviceEvents, GATEWAY_API_PATHS.heartbeat];

  it.each(paths)('%s sin clave, con clave inventada y con cookie de admin -> 401', async (path) => {
    const post = () => request(server).post(`/api/v1${path}`);
    expect((await post().send({ device_code: 'btn-01' })).status).toBe(401);
    expect((await post().set(GATEWAY_KEY_HEADER, 'inventada').send({ device_code: 'btn-01' })).status).toBe(401);
    expect((await post().set('Cookie', cookies.get('bar-demo/admin')!).send({ device_code: 'btn-01' })).status).toBe(401);
  });
});

describe('Socket.IO: lo que las suites de realtime aún no fijaban', () => {
  const connect = (cookie?: string) => {
    const s = io(origin, { path: REALTIME_PATH, transports: ['websocket'], reconnection: false, forceNew: true, extraHeaders: cookie ? { cookie } : {} });
    sockets.push(s);
    return s;
  };
  const connected = (s: ClientSocket) => new Promise<void>((res, rej) => { s.on('connect', res); s.on('connect_error', (e: Error) => rej(e)); });
  const subscribe = (s: ClientSocket, payload: unknown) => new Promise<unknown>((res) => s.emit(E.subscribe, payload, res));
  const next = <T>(s: ClientSocket, event: string, ms = 3000) =>
    new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error(`sin ${event}`)), ms); s.once(event, (p: T) => { clearTimeout(t); res(p); }); });
  const closed = (s: ClientSocket) => new Promise<string>((res) => s.once('disconnect', res));

  it('local ajeno -> not_found; id mal formado -> validation; superadmin sin negocio elegido -> not_found', async () => {
    const barra = connect(cookies.get('bar-demo/barra'));
    await connected(barra);
    expect(await subscribe(barra, { location_id: pisosLocation })).toEqual({ ok: false, code: 'not_found' });
    expect(await subscribe(barra, { location_id: ZERO })).toEqual({ ok: false, code: 'not_found' });
    expect(await subscribe(barra, { location_id: 'no-es-uuid' })).toEqual({ ok: false, code: 'validation' });
    expect(await subscribe(barra, { room: `loc:${pisosLocation}` })).toEqual({ ok: false, code: 'validation' });
    const root = connect(await login('labs', 'superadmin', 'labs/superadmin-ws'));
    await connected(root);
    expect(await subscribe(root, { location_id: demoLocation })).toEqual({ ok: false, code: 'not_found' });
  });

  it('un llamado del local ajeno no llega a quien intentó suscribirse; el control sí lo recibe en su propio local', async () => {
    const barra = connect(cookies.get('bar-demo/barra')), pisosAdmin = connect(cookies.get('bar-demo-pisos/admin'));
    await Promise.all([connected(barra), connected(pisosAdmin)]);
    await subscribe(barra, { location_id: pisosLocation }); // rechazado: no entra a la sala
    expect(await subscribe(pisosAdmin, { location_id: pisosLocation })).toEqual({ ok: true });
    let leaked = false;
    barra.on(E.serviceCallChanged, () => { leaked = true; });
    const own = next(pisosAdmin, E.serviceCallChanged);
    // Reconocer el llamado de pisos genera service_call.changed en su sala.
    expect((await call(cookies.get('bar-demo-pisos/admin'), 'post', `/locations/${pisosLocation}/service-calls/${pisos.call}/acknowledge`)).status).toBe(200);
    await h.tickHospitality();
    await own;
    await new Promise((res) => setTimeout(res, 400));
    expect(leaked).toBe(false);
  });

  it('sesión vencida: no conecta; vencida tras el handshake, location.subscribe responde session_invalid y cierra el socket', async () => {
    const cookie = await login('bar-demo', 'mesero1', 'ws-expired');
    const live = connect(cookie);
    await connected(live);
    await h.get<{ $executeRawUnsafe(sql: string): Promise<unknown> }>('CORE_PRISMA').$executeRawUnsafe(
      `UPDATE core.sessions SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM core.app_users WHERE username = 'mesero1')`,
    );
    const done = closed(live);
    expect(await subscribe(live, { location_id: demoLocation })).toEqual({ ok: false, code: 'session_invalid' });
    expect(await done).toBe('io server disconnect');
    await expect(connected(connect(cookie))).rejects.toThrow('unauthorized');
  });

  it('sesión cerrada tras el handshake: location.subscribe responde session_invalid y cierra el socket', async () => {
    const cookie = await login('bar-demo', 'mesero1', 'ws-closed');
    const live = connect(cookie);
    await connected(live);
    expect((await call(cookie, 'post', '/auth/logout')).status).toBe(204);
    const done = closed(live);
    expect(await subscribe(live, { location_id: demoLocation })).toEqual({ ok: false, code: 'session_invalid' });
    expect(await done).toBe('io server disconnect');
  });
});
