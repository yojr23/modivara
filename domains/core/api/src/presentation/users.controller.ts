import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import {
  CORE_API_PATHS, createUserRequestSchema, idParamSchema, resetPasswordRequestSchema, setLocationRolesRequestSchema,
  type MembershipResponse, type UserResponse, type UsersResponse,
} from '@modivara/core-contracts';
import {
  CreateUser, DeactivateUser, ListUsers, ResetPassword, RevokeUserSessions, SetLocationRoles, type ActorContext,
} from '../application/index.js';
import type { AppUser } from '../domain/index.js';
import { CurrentActor, RequirePermission } from './guards/decorators.js';
import { parseWith } from './http.js';

const toUser = (u: AppUser): UserResponse => ({ id: u.id, username: u.username, display_name: u.displayName, is_owner: u.isOwner, active: u.isActive });

/** Administración de usuarios del negocio (F1-09). La regla de fondo vive en los casos de uso; aquí solo borde HTTP. */
@Controller()
@RequirePermission('core.users.manage')
export class UsersController {
  constructor(
    @Inject(ListUsers) private readonly listUsers: ListUsers,
    @Inject(CreateUser) private readonly createUser: CreateUser,
    @Inject(ResetPassword) private readonly resetPassword: ResetPassword,
    @Inject(DeactivateUser) private readonly deactivateUser: DeactivateUser,
    @Inject(RevokeUserSessions) private readonly revokeSessions: RevokeUserSessions,
    @Inject(SetLocationRoles) private readonly setRoles: SetLocationRoles,
  ) {}

  @Get(CORE_API_PATHS.users)
  async list(@CurrentActor() actor: ActorContext): Promise<UsersResponse> {
    return { users: (await this.listUsers.execute({ actor })).map(toUser) };
  }

  @Post(CORE_API_PATHS.users)
  async create(@CurrentActor() actor: ActorContext, @Body() body: unknown): Promise<UserResponse> {
    const input = parseWith(createUserRequestSchema, body);
    const user = await this.createUser.execute({
      actor, username: input.username, displayName: input.display_name, password: input.password, isOwner: input.is_owner,
    });
    return toUser(user);
  }

  @Post(CORE_API_PATHS.userPasswordReset)
  @HttpCode(204)
  async reset(@CurrentActor() actor: ActorContext, @Param('userId') userId: string, @Body() body: unknown): Promise<void> {
    const input = parseWith(resetPasswordRequestSchema, body);
    await this.resetPassword.execute({ actor, userId: parseWith(idParamSchema, userId), newPassword: input.new_password });
  }

  @Post(CORE_API_PATHS.userDeactivate)
  @HttpCode(204)
  async deactivate(@CurrentActor() actor: ActorContext, @Param('userId') userId: string): Promise<void> {
    await this.deactivateUser.execute({ actor, userId: parseWith(idParamSchema, userId) });
  }

  @Post(CORE_API_PATHS.userRevokeSessions)
  @HttpCode(204)
  async revoke(@CurrentActor() actor: ActorContext, @Param('userId') userId: string): Promise<void> {
    await this.revokeSessions.execute({ actor, userId: parseWith(idParamSchema, userId) });
  }

  // Ruta con `:locationId`: PermissionGuard exige `core.users.manage` en ESE local (no solo en alguno).
  @Put(CORE_API_PATHS.userLocationRoles)
  async roles(
    @CurrentActor() actor: ActorContext,
    @Param('userId') userId: string,
    @Param('locationId') locationId: string,
    @Body() body: unknown,
  ): Promise<MembershipResponse> {
    const input = parseWith(setLocationRolesRequestSchema, body);
    const m = await this.setRoles.execute({
      actor, userId: parseWith(idParamSchema, userId), locationId: parseWith(idParamSchema, locationId), roles: input.roles,
    });
    return { id: m.id, user_id: m.userId, location_id: m.locationId, roles: [...m.roles] };
  }
}
