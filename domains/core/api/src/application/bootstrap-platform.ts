import { newId, ValidationError } from '@modivara/core-contracts';
import { AppUser, assertPasswordPolicy, Organization } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { AdminTransactions, PasswordHasher } from './ports/index.js';

export const PLATFORM_SLUG = 'labs';

/**
 * Arranque de la organización de plataforma y su primer superadmin (ADR-002 D3). Es la única operación sin actor:
 * solo se invoca desde el seed/CLI, nunca desde HTTP. Idempotente; no cambia la contraseña de un superadmin existente.
 * Devuelve el actor con `sessionId` vacío (no hay sesión): sirve para encadenar los demás casos de uso del seed.
 */
export class BootstrapPlatform {
  constructor(
    private readonly admin: AdminTransactions,
    private readonly hasher: PasswordHasher,
  ) {}

  execute(input: { username: string; displayName: string; password: string }): Promise<ActorContext> {
    return this.admin.withTransaction(async (tx) => {
      let org = await tx.organizations.findBySlug({ slug: PLATFORM_SLUG });
      if (org && !org.isPlatform) throw new ValidationError(`Slug ${PLATFORM_SLUG} is taken by a customer organization`);
      const created = !org;
      org ??= Organization.create({ id: newId(), slug: PLATFORM_SLUG, name: 'Modivara Labs', isPlatform: true });
      if (created) await tx.organizations.save(org);

      const username = input.username.trim().toLowerCase();
      let user = await tx.users.findActiveByUsername({ organizationId: org.id, username });
      if (!user) {
        assertPasswordPolicy(input.password);
        user = AppUser.create({
          id: newId(), organizationId: org.id, username, displayName: input.displayName,
          passwordHash: await this.hasher.hash(input.password), now: new Date(),
        });
        await tx.users.save(user);
        await tx.audit.record({
          id: newId(), organizationId: org.id, actorUserId: user.id, action: 'user.created', targetType: 'user',
          targetId: user.id, details: { username, bootstrap: true }, occurredAt: new Date(),
        });
      }
      return { actorUserId: user.id, organizationId: org.id, isPlatform: true, isOwner: user.isOwner, sessionId: '', actingOrganizationId: null };
    });
  }
}
