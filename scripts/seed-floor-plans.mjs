// SOLO DEMO (opcional, después de `pnpm seed`): carga en Bar Demo la escena diseñada con el responsable para el editor (L-05):
// «Primer piso» (Barra, Zona A, Zona B) y «Segundo piso» (Zona VIP, Terraza), con muros, entrada, escalera y ventanas.
// El seed base no cambia (DATA-001 §7: Bar Demo con 15 mesas sin zonas); esto lo transforma por la API, como lo haría un admin
// desde el editor: crea las dos zonas, mueve Mesa 1–12 y 13–15, crea Mesa 16 y 17 (sin botón) y publica los dos planos.
// Idempotente: si «Primer piso» ya tiene su plano con el área «Barra», no hace nada.
// Uso: SEED_PASSWORD=... node scripts/seed-floor-plans.mjs   (DEMO_URL=http://localhost por defecto; lee .env si falta la clave)
import { existsSync, readFileSync } from 'node:fs';

const BASE = process.env.DEMO_URL ?? 'http://localhost';
const API = `${BASE}/api/v1`;
const password = process.env.SEED_PASSWORD
  ?? (existsSync('.env') ? readFileSync('.env', 'utf8').match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim() : undefined);
if (!password) throw new Error('Falta SEED_PASSWORD (entorno o .env).');

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ slug: 'bar-demo', username: 'admin', password }),
});
if (!login.ok) throw new Error(`Login bar-demo/admin → ${login.status}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { cookie, origin: BASE, ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const loc = (await call('GET', '/me')).locations[0].id;
const L = `/locations/${loc}`;

async function zone(name, position) {
  const found = (await call('GET', `${L}/zones`)).find((z) => z.name === name);
  return found ?? call('POST', `${L}/zones`, { name, position });
}
const primer = await zone('Primer piso', 0);
const segundo = await zone('Segundo piso', 1);

const current = await call('GET', `${L}/layouts/draft?zone_id=${primer.id}`);
if (current.published?.elements.some((e) => e.type === 'area' && e.name === 'Barra')) {
  console.log('seed:planos-demo: Bar Demo ya tiene los planos de Primer y Segundo piso; nada que hacer.');
  process.exit(0);
}

// Mesas: 1–12 al primer piso, 13–17 al segundo (16 y 17 no existen en el seed base).
let tables = await call('GET', `${L}/tables`);
const byLabel = (label) => tables.find((t) => t.label === label);
for (let n = 16; n <= 17; n++) if (!byLabel(`Mesa ${n}`)) tables.push(await call('POST', `${L}/tables`, { label: `Mesa ${n}`, zone_id: segundo.id }));
for (let n = 1; n <= 17; n++) {
  const t = byLabel(`Mesa ${n}`);
  const zoneId = n <= 12 ? primer.id : segundo.id;
  if (t && t.zone_id !== zoneId) await call('PATCH', `${L}/tables/${t.id}`, { zone_id: zoneId });
}
tables = await call('GET', `${L}/tables`);

const id = () => crypto.randomUUID();
const at = (n, shape, x, y, w = 70, h = w) => ({ id: id(), type: 'table', table_id: byLabel(`Mesa ${n}`).id, shape, x, y, width: w, height: h, rotation: 0 });
const box = (type, x, y, width, height) => ({ id: id(), type, x, y, width, height, rotation: 0 });
const text = (t, x, y, rotation = 0) => ({ id: id(), type: 'label', text: t, x, y, rotation });
const area = (name, x, y, width, height) => ({ id: id(), type: 'area', name, x, y, width, height, rotation: 0 });

// Escena del prototipo elegido (commit 695547b, plan.tsx). Mesas 11 y 12 quedan sin ubicar a propósito.
const PLANS = [
  {
    zone: primer, width: 1000, height: 640,
    elements: [
      area('Barra', 50, 50, 600, 220), area('Zona A', 50, 290, 600, 280), area('Zona B', 680, 120, 260, 450),
      box('wall', 20, 20, 960, 14), box('wall', 20, 20, 14, 600), box('wall', 966, 20, 14, 600),
      box('wall', 20, 606, 130, 14), box('door', 150, 606, 100, 14), box('wall', 250, 606, 730, 14),
      text('Entrada', 160, 594), text('Escalera al segundo piso', 700, 80), text('Ventanas', 946, 250, 90),
      box('bar', 110, 92, 480, 50),
      at(1, 'round', 120, 180), at(2, 'round', 260, 180), at(3, 'round', 400, 180), at(4, 'round', 540, 180),
      at(5, 'square', 120, 340), at(6, 'square', 260, 340), at(7, 'rect', 400, 340, 140, 70),
      at(10, 'round', 270, 460, 90),
      at(8, 'rect', 770, 170, 70, 130), at(9, 'rect', 770, 380, 70, 130),
    ],
  },
  {
    zone: segundo, width: 800, height: 500,
    elements: [
      area('Zona VIP', 50, 50, 230, 390), area('Terraza', 340, 50, 410, 400),
      box('wall', 20, 20, 760, 14), box('wall', 20, 20, 14, 460), box('wall', 766, 20, 14, 460),
      box('wall', 20, 466, 30, 14), box('door', 50, 466, 100, 14), box('wall', 150, 466, 630, 14),
      box('wall', 300, 20, 14, 170), box('door', 300, 190, 14, 100), box('wall', 300, 290, 14, 190),
      text('Escalera', 60, 456), text('Jardinera', 600, 430),
      at(16, 'square', 120, 120), at(17, 'rect', 90, 280, 150, 70),
      at(13, 'round', 390, 120), at(14, 'round', 560, 120), at(15, 'round', 470, 290),
    ],
  },
];

for (const p of PLANS) {
  const { draft } = await call('GET', `${L}/layouts/draft?zone_id=${p.zone.id}`);
  const saved = await call('PUT', `${L}/layouts/draft`, { zone_id: p.zone.id, revision: draft?.revision ?? 0, canvas_width: p.width, canvas_height: p.height, elements: p.elements });
  const published = await call('POST', `${L}/layouts/publish`, { zone_id: p.zone.id, revision: saved.revision });
  console.log(`seed:planos-demo: ${p.zone.name} publicado (versión ${published.version}).`);
}
