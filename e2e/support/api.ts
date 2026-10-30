import { expect, request, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BASE_URL, authFile, gatewayFile, type User } from './env';

// Cliente de la API para preparar y limpiar datos de las pruebas (el navegador prueba la UI; esto solo arma el escenario).

const API = '/api/v1';
const origin = { origin: BASE_URL }; // OriginGuard: las mutaciones con cookie exigen el Origin del portal

/** Contexto HTTP con la sesión que dejó global-setup para ese usuario. */
export const apiAs = (user: User) => request.newContext({ baseURL: BASE_URL, storageState: authFile(user), extraHTTPHeaders: origin });

export async function json<T = any>(ctx: APIRequestContext, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown): Promise<T> {
  const res = await ctx.fetch(`${API}${path}`, { method, data });
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const locationOf = async (ctx: APIRequestContext): Promise<string> => (await json(ctx, 'GET', '/me')).locations[0].id;

export async function tableId(ctx: APIRequestContext, loc: string, label: string, zoneName?: string): Promise<string> {
  const tables = await json<any[]>(ctx, 'GET', `/locations/${loc}/tables`);
  const t = tables.find((x) => x.label === label && (zoneName === undefined || x.zone_name === zoneName));
  if (!t) throw new Error(`No existe ${label}`);
  return t.id;
}

/** Deja la mesa sin llamado activo (reconoce y finaliza lo que haya), para que una pulsación cree un llamado nuevo. */
export async function closeActiveCalls(ctx: APIRequestContext, loc: string, table: string) {
  const page = await json(ctx, 'GET', `/locations/${loc}/service-calls?status=active&table_id=${table}&limit=200`);
  for (const c of page.items) {
    if (c.status === 'pending') await json(ctx, 'POST', `/locations/${loc}/service-calls/${c.id}/acknowledge`);
    await json(ctx, 'POST', `/locations/${loc}/service-calls/${c.id}/complete`);
  }
}

/** Pulsación de un botón por HTTP, como el gateway real (TECH-001 §7). Devuelve el resultado de la ingesta. */
export async function press(slug: string, deviceCode: string): Promise<{ result: string; service_call_id?: string }> {
  const { key } = JSON.parse(readFileSync(gatewayFile(slug), 'utf8'));
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post(`${API}/device-events`, { headers: { 'x-gateway-key': key }, data: { device_code: deviceCode } });
  expect(res.ok(), `pulsación ${deviceCode} → ${res.status()}`).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  return body;
}

/** Llamados creados desde `from` (todas las páginas del historial). */
export async function callsSince(ctx: APIRequestContext, loc: string, from: Date) {
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await json(ctx, 'GET', `/locations/${loc}/service-calls?status=all&from=${encodeURIComponent(from.toISOString())}&limit=200${cursor ? `&cursor=${cursor}` : ''}`);
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return items;
}

/** Publica el plano de una zona con los elementos que devuelva `edit` a partir del publicado vigente. */
export async function republish(ctx: APIRequestContext, loc: string, zoneId: string | null, edit: (elements: any[]) => any[]) {
  const q = zoneId ? `?zone_id=${zoneId}` : '';
  const { draft, published } = await json(ctx, 'GET', `/locations/${loc}/layouts/draft${q}`);
  const base = draft ?? published;
  const saved = await json(ctx, 'PUT', `/locations/${loc}/layouts/draft`, {
    zone_id: zoneId, revision: draft?.revision ?? 0, canvas_width: base.canvas_width, canvas_height: base.canvas_height, elements: edit(base.elements),
  });
  return json(ctx, 'POST', `/locations/${loc}/layouts/publish`, { zone_id: zoneId, revision: saved.revision });
}
