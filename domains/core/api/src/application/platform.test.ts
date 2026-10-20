import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@modivara/core-contracts';
import { PermissionDeniedError } from '../domain/index.js';
import { TEST_PASSWORD, World } from '../testing/index.js';
import { BootstrapPlatform } from './bootstrap-platform.js';
import { ProvisionOrganization } from './provision-organization.js';

describe('casos de uso de plataforma (seed)', () => {
  let w: World;
  let bootstrap: BootstrapPlatform, provision: ProvisionOrganization;
  const input = { username: 'superadmin', displayName: 'Super', password: TEST_PASSWORD };

  beforeEach(() => {
    w = new World();
    bootstrap = new BootstrapPlatform(w.admin, w.hasher);
    provision = new ProvisionOrganization(w.admin);
  });

  it('BootstrapPlatform crea labs + superadmin una sola vez', async () => {
    const a = await bootstrap.execute(input);
    const b = await bootstrap.execute(input);
    expect(b.actorUserId).toBe(a.actorUserId);
    expect(a.isPlatform).toBe(true);
    expect(w.organizations.items.size).toBe(1);
    expect(w.users.items.size).toBe(1);
    expect(w.audit.entries.map((e) => e.action)).toEqual(['user.created']);
  });

  it('ProvisionOrganization crea negocio, local y entitlements, auditado, y es idempotente', async () => {
    const root = await bootstrap.execute(input);
    const req = { actor: root, slug: 'bar-demo', name: 'Bar Demo', locations: [{ name: 'Principal' }], modules: ['hospitality', 'commerce'] as const };
    const first = await provision.execute(req);
    const audited = w.audit.entries.length;
    const second = await provision.execute(req);
    expect(second.organization.id).toBe(first.organization.id);
    expect(second.locations[0]!.id).toBe(first.locations[0]!.id);
    expect(await w.entitlements.listEnabledModules({ organizationId: first.organization.id })).toEqual(['hospitality', 'commerce']);
    expect(w.audit.entries).toHaveLength(audited);
    expect(w.audit.entries.every((e) => e.actorUserId === root.actorUserId)).toBe(true);
  });

  it('slugs reservados o inválidos se rechazan; un negocio cliente no puede provisionar', async () => {
    const root = await bootstrap.execute(input);
    for (const slug of ['labs', 'api', 'sim', 'assets', 'login', 'static', 'Mal Slug']) {
      await expect(provision.execute({ actor: root, slug, name: 'X', locations: [], modules: [] })).rejects.toThrow(ValidationError);
    }
    const client = w.actorOf(await w.addUser(w.sol, 'duena', { isOwner: true }));
    await expect(provision.execute({ actor: client, slug: 'otro', name: 'X', locations: [], modules: [] })).rejects.toThrow(PermissionDeniedError);
  });
});
