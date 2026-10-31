import { expect, it } from 'vitest';
import { PermissionDeniedError } from '../domain/index.js';
import { World } from '../testing/index.js';
import { ListOrganizations } from './list-organizations.js';

it('lista negocios de clientes con sus locales por nombre, sin la plataforma', async () => {
  const w = await World.create();
  const root = w.actorOf(await w.addUser(w.platform, 'root'));
  const out = await new ListOrganizations(w.organizations).execute({ actor: root });
  expect(out.map((r) => r.organization.slug)).toEqual(['bar-luna', 'bar-sol']);
  expect(out[0]!.locations.map((l) => l.id)).toEqual([w.lunaCenter.id]);
  expect(out[1]!.locations.map((l) => l.id)).toEqual([w.solCenter.id]);
});

it('un usuario de negocio no puede listar', async () => {
  const w = await World.create();
  const owner = w.actorOf(await w.addUser(w.sol, 'duena', { isOwner: true }));
  await expect(new ListOrganizations(w.organizations).execute({ actor: owner })).rejects.toThrow(PermissionDeniedError);
});
