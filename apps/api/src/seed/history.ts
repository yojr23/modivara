import type { INestApplicationContext } from '@nestjs/common';
import { addDays, civilDateIn, localTimeToUtc, seededRandom, CORE_ACCESS_PORT, type CoreAccessPort } from '@modivara/core-contracts';
import { BootstrapPlatform, ProvisionOrganization } from '@modivara/core-api';
import { SeedCallHistory } from '@modivara/hospitality-api';
import { GetBalances, ListMovementReasons, ListMovements, ListProducts, EnsureDefaultStockLocation, RegisterMovement, type StockContext } from '@modivara/commerce-api';
import { BUSINESSES, MODULES, SUPERADMIN } from './core.js';
import { BAR_PRODUCTS, seedKey } from './commerce.js';

// F5-10: historial de 14 días que terminan ayer, solo para Bar Demo (el que se muestra en la demo). Cada dominio escribe lo suyo
// con fechas pasadas y outbox v1; analytics lo recibe por los pollers de la API (o `analytics:rebuild`), nunca se inserta en analytics.
const DAYS = 14;
const SEED = 20261027;
const ALREADY_SEEDED = new Error('already seeded');

/** Devuelve cuántos llamados y movimientos creó (0 y 0 si ya había historial). */
export async function seedHistory(app: INestApplicationContext, password: string): Promise<{ calls: number; movements: number }> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:history se niega a correr con NODE_ENV=production: es solo para datos de demo.');
  const root = await app.get(BootstrapPlatform).execute({ ...SUPERADMIN, password });
  const b = BUSINESSES.find((x) => x.slug === 'bar-demo')!;
  const { organization, locations } = await app.get(ProvisionOrganization).execute({ actor: root, slug: b.slug, name: b.name, locations: [{ name: b.location }], modules: MODULES });
  const ctx: StockContext = { organizationId: organization.id, locationId: locations[0]!.id, actorUserId: root.actorUserId };
  const tz = (await app.get<CoreAccessPort>(CORE_ACCESS_PORT).getLocation(ctx.locationId))!.timezone;

  const calls = await app.get(SeedCallHistory).execute(ctx, { days: DAYS });
  return { calls, movements: await seedStockHistory(app, ctx, tz) };
}

async function seedStockHistory(app: INestApplicationContext, ctx: StockContext, tz: string): Promise<number> {
  const today = civilDateIn(tz, new Date());
  const products = new Map((await app.get(ListProducts).execute(ctx)).map((p) => [p.name, p]));
  const reasons = new Map((await app.get(ListMovementReasons).execute(ctx)).map((r) => [r.name, r.id]));
  const stockLocation = await app.get(EnsureDefaultStockLocation).execute(ctx);
  const register = app.get(RegisterMovement);

  // Si el stock inicial es reciente (base sembrada antes de F5-10), el historial quedaría antes de su propia entrada.
  const first = products.get(BAR_PRODUCTS[0]!.name)!;
  const latest = await app.get(ListMovements).execute({ ...ctx, productId: first.id, limit: 2 });
  if (latest.length === 1 && latest[0]!.occurredAt >= localTimeToUtc(tz, addDays(today, -DAYS))) {
    throw new Error('El stock inicial de commerce tiene fecha reciente: recrea la base de demo (docker compose down -v) y vuelve a sembrar.');
  }

  let count = 0;
  try {
    for (const [index, p] of BAR_PRODUCTS.entries()) {
      const product = products.get(p.name)!;
      const rnd = seededRandom(SEED + index);
      const step = p.unit === 'kg' ? 0.5 : 1;
      const initial = Number(p.stock);
      let balance = initial;
      let n = 0;
      const move = async (direction: 'in' | 'out' | 'adjust', qty: number, reason: string, at: Date) => {
        const r = await register.execute({
          ...ctx, stockLocationId: stockLocation.id, productId: product.id, reasonId: reasons.get(reason)!, direction, quantity: String(qty),
          note: 'Historial de demo (seed)', idempotencyKey: seedKey(ctx.locationId, `${p.name}#${n++}`), occurredAt: at,
        });
        balance += direction === 'in' ? qty : direction === 'out' ? -qty : qty;
        // Clave ya usada = el historial ya se sembró: se detiene sin tocar nada más.
        if (r.replayed) throw ALREADY_SEEDED;
        count++;
      };
      for (let back = DAYS; back >= 1; back--) {
        const day = addDays(today, -back);
        const at = (h: number) => localTimeToUtc(tz, day, h, Math.floor(rnd() * 60), Math.floor(rnd() * 60));
        // Compras periódicas (cada 5 días, escalonadas por producto) y, si el saldo queda bajo, reposición a la apertura.
        if (back % 5 === index % 5 || balance < initial * 0.3) {
          await move('in', Math.round((initial * 0.6) / step) * step, 'Compra', at(9));
        }
        if (p.name === 'Ron' && back === 7) await move('adjust', -1, 'Corrección de conteo', at(11));
        for (let i = 0, outs = 1 + Math.floor(rnd() * 2); i < outs; i++) {
          const qty = Math.min(balance, step * (1 + Math.floor(rnd() * Math.max(1, (initial * 0.08) / step))));
          if (qty <= 0) continue;
          const reason = (x: number) => (x < 0.8 ? 'Venta' : x < 0.92 ? 'Merma' : 'Cortesía');
          await move('out', qty, reason(rnd()), at(19 + i * 2));
        }
      }
      const [row] = await app.get(GetBalances).execute({ ...ctx, stockLocationId: stockLocation.id, productId: product.id });
      if (Number(row!.quantity.toString()) !== balance) throw new Error(`Saldo de ${p.name} (${row!.quantity}) no coincide con el historial (${balance})`);
    }
  } catch (e) {
    if (e !== ALREADY_SEEDED) throw e;
  }
  return count;
}
