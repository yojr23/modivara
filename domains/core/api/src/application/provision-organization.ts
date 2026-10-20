import { customerSlugSchema, newId, ValidationError, type ModuleName, type Permission } from '@modivara/core-contracts';
import { Entitlement, Location, Organization, PermissionDeniedError } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { AdminTransaction, AdminTransactions } from './ports/index.js';

export interface ProvisionOrganizationInput {
  actor: ActorContext;
  slug: string;
  name: string;
  locations: Array<{ name: string; timezone?: string }>;
  /** Módulos que quedan habilitados; los demás no se tocan. */
  modules: readonly ModuleName[];
}

export interface ProvisionOrganizationOutput {
  organization: Organization;
  locations: Location[];
}

const REQUIRED: Permission[] = ['platform.organizations.manage', 'platform.locations.manage', 'platform.entitlements.manage'];

/**
 * Alta de negocio cliente con sus locales y módulos (solo superadmin; auditada). Idempotente: lo que ya existe
 * (negocio por slug, local por nombre, entitlement) se conserva, para que el seed pueda repetirse.
 * Creación de negocios por API: por seed hasta el segundo cliente real (TECH-001 §16.3), por eso no hay controlador.
 */
export class ProvisionOrganization {
  constructor(private readonly admin: AdminTransactions) {}

  execute(input: ProvisionOrganizationInput): Promise<ProvisionOrganizationOutput> {
    const { actor } = input;
    if (!actor.isPlatform) throw new PermissionDeniedError(`${REQUIRED[0]} required`);
    const slug = customerSlugSchema.safeParse(input.slug);
    if (!slug.success) throw new ValidationError(`Invalid customer slug: ${input.slug}`);
    return this.admin.withTransaction((tx) => this.run(tx, input, slug.data));
  }

  private async run(tx: AdminTransaction, input: ProvisionOrganizationInput, slug: string): Promise<ProvisionOrganizationOutput> {
    const audit = (organizationId: string, action: string, targetType: string, targetId: string, details: Record<string, unknown>) =>
      tx.audit.record({ id: newId(), organizationId, actorUserId: input.actor.actorUserId, action, targetType, targetId, details, occurredAt: new Date() });

    let organization = await tx.organizations.findBySlug({ slug });
    if (organization?.isPlatform) throw new ValidationError(`Reserved slug: ${slug}`);
    if (!organization) {
      organization = Organization.create({ id: newId(), slug, name: input.name });
      await tx.organizations.save(organization);
      await audit(organization.id, 'organization.created', 'organization', organization.id, { slug });
    }

    const existing = await tx.locations.listActive({ organizationId: organization.id });
    const locations: Location[] = [];
    for (const wanted of input.locations) {
      let location = existing.find((l) => l.name === wanted.name.trim());
      if (!location) {
        location = Location.create({ id: newId(), organizationId: organization.id, name: wanted.name, timezone: wanted.timezone });
        await tx.locations.save(location);
        await audit(organization.id, 'location.created', 'location', location.id, { name: location.name });
      }
      locations.push(location);
    }

    for (const module of input.modules) {
      const current = await tx.entitlements.find({ organizationId: organization.id, module });
      if (current?.enabled) continue;
      const entitlement = current ?? Entitlement.create({ organizationId: organization.id, module });
      entitlement.setEnabled(true);
      await tx.entitlements.save(entitlement);
      await audit(organization.id, 'entitlement.enabled', 'entitlement', organization.id, { module });
    }
    return { organization, locations };
  }
}
