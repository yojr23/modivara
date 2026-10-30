import { request } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AUTH_DIR, BASE_URL, USERS, authFile, gatewayFile, seedPassword } from './support/env';

const API = `${BASE_URL}/api/v1`;

async function login(slug: string, username: string) {
  const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
  const res = await ctx.post(`${API}/auth/login`, { data: { slug, username, password: seedPassword() } });
  if (res.status() === 429) throw new Error('Límite de logins por IP (30 cada 15 min) agotado: espera o reinicia la API con `docker compose restart api`.');
  if (!res.ok()) throw new Error(`Login ${slug}/${username} → ${res.status()}. ¿Se corrió \`pnpm seed\` con esta SEED_PASSWORD?`);
  return ctx;
}

/** Gateway de prueba del negocio: se crea una vez como superadmin y su clave se guarda en e2e/.auth (fuera de git). */
async function ensureGateway(slug: string) {
  const file = gatewayFile(slug);
  if (existsSync(file)) {
    const { key } = JSON.parse(readFileSync(file, 'utf8'));
    const hb = await (await request.newContext()).post(`${API}/gateways/heartbeat`, { headers: { 'x-gateway-key': key }, data: {} });
    if (hb.ok()) return;
  }
  const admin = await login(slug, 'admin');
  const me = await (await admin.get(`${API}/me`)).json();
  const root = await login('labs', 'superadmin');
  await root.put(`${API}/platform/acting-organization`, { data: { organization_id: me.organization.id } });
  const gw = await root.post(`${API}/platform/locations/${me.locations[0].id}/gateways`, { data: { name: 'Gateway E2E' } });
  if (!gw.ok()) throw new Error(`No se pudo crear el gateway de prueba: ${gw.status()}`);
  writeFileSync(file, JSON.stringify({ key: (await gw.json()).key }));
  await root.put(`${API}/platform/acting-organization`, { data: { organization_id: null } });
}

export default async function globalSetup() {
  const health = await (await request.newContext()).get(`${API}/health`).catch(() => null);
  if (!health?.ok()) throw new Error(`La API no responde en ${API}/health. Levanta la demo: docker compose up --build -d && pnpm seed`);
  mkdirSync(AUTH_DIR, { recursive: true });
  for (const user of USERS) {
    const ctx = await login(user[0], user[1]);
    await ctx.storageState({ path: authFile(user) });
    await ctx.dispose();
  }
  await ensureGateway('bar-demo');
}
