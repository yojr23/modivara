import { ConflictError, newId, NotFoundError, isValidUsername, ValidationError } from '@modivara/core-contracts';
import { AppUser, assertPasswordPolicy, PermissionDeniedError } from '../domain/index.js';
import { assertCanManageUsers, effectiveOrganizationId, type ActorContext } from './actor.js';
import type { MembershipRepository, OrganizationRepository, PasswordHasher, UserRepository } from './ports/index.js';

export interface CreateUserInput {
  actor: ActorContext;
  /** Solo el superadmin puede indicar un negocio distinto al suyo/actual. */
  organizationId?: string;
  username: string;
  displayName: string;
  password: string;
  isOwner?: boolean;
}

export class CreateUser {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: CreateUserInput): Promise<AppUser> {
    const { actor } = input;
    await assertCanManageUsers(actor, this.memberships);

    const targetId = input.organizationId ?? effectiveOrganizationId(actor);
    if (!actor.isPlatform && targetId !== actor.organizationId) throw new PermissionDeniedError('Cannot create users in another organization');
    const org = await this.organizations.findById(targetId);
    if (!org?.isActive) throw new NotFoundError('Organization');
    // Un negocio cliente nunca crea superadmins: los usuarios de la organización de plataforma lo son.
    if (org.isPlatform && !actor.isPlatform) throw new PermissionDeniedError('Only platform users can create platform users');
    // OPEN: ¿puede un admin (no dueño) crear un dueño? Por ahora solo el superadmin.
    if (input.isOwner && !actor.isPlatform) throw new PermissionDeniedError('Only platform users can create owners');

    const username = input.username.trim().toLowerCase();
    if (!isValidUsername(username)) throw new ValidationError(`Invalid username: ${input.username}`);
    assertPasswordPolicy(input.password);
    if (await this.users.findActiveByUsername(org.id, username)) throw new ConflictError('Username already in use');

    const user = AppUser.create({
      id: newId(),
      organizationId: org.id,
      username,
      displayName: input.displayName,
      passwordHash: await this.hasher.hash(input.password),
      isOwner: input.isOwner,
      now: new Date(),
    });
    await this.users.save(user);
    return user;
  }
}
