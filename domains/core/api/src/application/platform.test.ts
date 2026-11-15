import { beforeEach, describe, expect, it } from 'vitest';
import { locationCreatedEventSchema, moduleDisabledEventSchema, moduleEnabledEventSchema, NotFoundError, toEventEnvelope, ValidationError } from '@modivara/core-contracts';
import { PermissionDeniedError } from '../domain/index.js';
import { TEST_PASSWORD, World } from '../testing/index.js';
import { BootstrapPlatform } from './bootstrap-platform.js';
import { ProvisionOrganization } from './provision-organization.js';
import { SetModuleEnabled } from './set-module-enabled.js';

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

  it('cada local nuevo deja un core.location.created.v1 válido en el outbox y reprovisionar no lo duplica', async () => {
    const root = await bootstrap.execute(input);
    const req = { actor: root, slug: 'bar-demo', name: 'Bar Demo', locations: [{ name: 'Centro' }, { name: 'Norte', timezone: 'America/Mexico_City' }], modules: [] as const };
    const { organization, locations } = await provision.execute(req);
    await provision.execute(req);
    const events = w.outbox.events.map((e) => locationCreatedEventSchema.parse(toEventEnvelope(e)));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.payload)).toEqual(locations.map((l) => ({
      location_id: l.id, organization_id: organization.id, organization_slug: 'bar-demo', location_name: l.name, timezone: l.timezone, created_by: root.actorUserId,
    })));
    expect(events.every((e) => e.aggregate_id === e.location_id)).toBe(true);
  });

  it('reprovisionar con un módulo nuevo publica core.module.enabled para los locales que ya existían', async () => {
    const root = await bootstrap.execute(input);
    const req = { actor: root, slug: 'zapateria', name: 'Zapatería', locations: [{ name: 'Centro' }], modules: [] as ('commerce')[] };
    const { locations } = await provision.execute(req);
    const since = w.outbox.events.length;
    await provision.execute({ ...req, modules: ['commerce'] });
    const enabled = w.outbox.events.slice(since).map((e) => moduleEnabledEventSchema.parse(toEventEnvelope(e)));
    expect(enabled.map((e) => [e.location_id, e.payload.module])).toEqual([[locations[0]!.id, 'commerce']]);
    await provision.execute({ ...req, modules: ['commerce'] });
    expect(w.outbox.events).toHaveLength(since + 1);
  });

  it('slugs reservados o inválidos se rechazan; un negocio cliente no puede provisionar', async () => {
    const root = await bootstrap.execute(input);
    for (const slug of ['labs', 'api', 'sim', 'assets', 'login', 'static', 'Mal Slug']) {
      await expect(provision.execute({ actor: root, slug, name: 'X', locations: [], modules: [] })).rejects.toThrow(ValidationError);
    }
    const client = w.actorOf(await w.addUser(w.sol, 'duena', { isOwner: true }));
    await expect(provision.execute({ actor: client, slug: 'otro', name: 'X', locations: [], modules: [] })).rejects.toThrow(PermissionDeniedError);
  });

  it('SetModuleEnabled (MOD-14/26): auditado, un evento por local activo, sin cambios no hace nada; solo superadmin y solo negocios cliente', async () => {
    const root = await bootstrap.execute(input);
    const { organization, locations } = await provision.execute({ actor: root, slug: 'zapateria', name: 'Z', locations: [{ name: 'A' }, { name: 'B' }], modules: [] });
    const set = new SetModuleEnabled(w.admin);
    const run = (enabled: boolean) => set.execute({ actor: root, organizationId: organization.id, module: 'commerce', enabled });
    const since = w.outbox.events.length;

    expect((await run(true)).enabled).toBe(true);
    await run(true);
    expect(await w.entitlements.listEnabledModules({ organizationId: organization.id })).toEqual(['commerce']);
    const enabled = w.outbox.events.slice(since).map((e) => moduleEnabledEventSchema.parse(toEventEnvelope(e)));
    expect(enabled.map((e) => [e.location_id, e.payload.module, e.aggregate_id])).toEqual(locations.map((l) => [l.id, 'commerce', organization.id]));

    expect((await run(false)).enabled).toBe(false);
    expect(w.outbox.events.slice(since + 2).map((e) => moduleDisabledEventSchema.parse(toEventEnvelope(e)).location_id)).toEqual(locations.map((l) => l.id));
    expect(w.audit.entries.filter((e) => e.action.startsWith('entitlement.')).map((e) => [e.action, e.details])).toEqual([
      ['entitlement.enabled', { module: 'commerce' }], ['entitlement.disabled', { module: 'commerce' }],
    ]);

    const client = w.actorOf(await w.addUser(w.sol, 'duena2', { isOwner: true }));
    await expect(set.execute({ actor: client, organizationId: organization.id, module: 'commerce', enabled: true })).rejects.toThrow(PermissionDeniedError);
    await expect(set.execute({ actor: root, organizationId: root.organizationId, module: 'commerce', enabled: true })).rejects.toThrow(NotFoundError);
  });
});
