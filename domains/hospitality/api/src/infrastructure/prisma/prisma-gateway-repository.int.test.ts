import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Gateway } from '../../domain/devices/gateway.js';
import { hospitalityPrismaForTests, resetHospitality, tenant } from '../../testing/integration.js';
import { PrismaGatewayRepository } from './prisma-gateway-repository.js';

const db = hospitalityPrismaForTests();
const repo = new PrismaGatewayRepository(db);
const t = tenant();
const other = tenant();
const by = '00000000-0000-7000-8000-00000000000a';

const create = async (loc = t) => {
  const created = Gateway.create({ ...loc, name: 'Barra', createdBy: by, now: new Date() });
  await repo.save(created.gateway);
  return created;
};

beforeEach(() => resetHospitality(db));
afterAll(() => db.$disconnect());

describe('PrismaGatewayRepository', () => {
  it('la clave son 32 bytes aleatorios en base64url y solo existe su SHA-256 en bytea', async () => {
    const { gateway, plainKey } = await create();
    const secret = plainKey.replace(/^mvg_/, '');
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    const [row] = await db.$queryRaw<{ key_hash: Uint8Array; len: number }[]>`SELECT key_hash, octet_length(key_hash) AS len FROM gateways WHERE id = ${gateway.id}::uuid`;
    expect(row!.len).toBe(32);
    expect(Buffer.from(row!.key_hash).toString('hex')).toBe(Gateway.hashKey(plainKey));
    // La clave en claro no está en ninguna columna de ninguna fila.
    const hits = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM gateways g WHERE g::text LIKE ${'%' + secret + '%'}`;
    expect(hits[0]!.n).toBe(0n);
  });

  it('findByKeyHash autentica con la clave correcta y no con una inválida', async () => {
    const { gateway, plainKey } = await create();
    expect((await repo.findByKeyHash(Gateway.hashKey(plainKey)))?.id).toBe(gateway.id);
    expect(await repo.findByKeyHash(Gateway.hashKey('mvg_clave-invalida'))).toBeNull();
    // Enviar el hash como si fuera la clave tampoco autentica.
    expect(await repo.findByKeyHash(Gateway.hashKey(gateway.keyHash))).toBeNull();
  });

  it('save actualiza last_seen_at sin tocar la clave; findById y listado acotados por tenant', async () => {
    const { gateway, plainKey } = await create();
    await create(other);
    const when = new Date('2026-10-20T12:00:00Z');
    const loaded = (await repo.findById({ ...t, id: gateway.id }))!;
    loaded.recordHeartbeat(when);
    await repo.save(loaded);
    const again = (await repo.findById({ ...t, id: gateway.id }))!;
    expect(again.lastSeenAt).toEqual(when);
    expect(again.keyHash).toBe(Gateway.hashKey(plainKey));
    expect(await repo.findById({ ...other, id: gateway.id })).toBeNull();
    expect(await repo.listByLocation(t)).toHaveLength(1);
  });
});
