import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  CORE_API_PATHS, SESSION_COOKIE, loginRequestSchema, type LoginResponse, type MeResponse,
} from '@modivara/core-contracts';
import { GetMe, Login, Logout, type ActorContext } from '../application/index.js';
import { CurrentActor, Public } from './guards/decorators.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { parseWith, sessionCookieOptions, type HttpRequest, type HttpResponse } from './http.js';

export const toSessionActor = (actor: ActorContext, user: { username: string; displayName: string }) => ({
  user_id: actor.actorUserId,
  organization_id: actor.organizationId,
  username: user.username,
  display_name: user.displayName,
  is_owner: actor.isOwner,
  is_platform: actor.isPlatform,
  acting_organization_id: actor.actingOrganizationId,
});

@Controller()
export class AuthController {
  constructor(
    @Inject(Login) private readonly login: Login,
    @Inject(Logout) private readonly logout: Logout,
    @Inject(GetMe) private readonly getMe: GetMe,
    @Inject(LoginRateLimiter) private readonly limiter: LoginRateLimiter,
  ) {}

  @Public()
  @Post(CORE_API_PATHS.login)
  @HttpCode(200)
  async doLogin(@Body() body: unknown, @Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse): Promise<LoginResponse> {
    const input = parseWith(loginRequestSchema, body);
    this.limiter.hit(req.ip ?? 'unknown');
    const out = await this.login.execute({ ...input, ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') || null });
    res.cookie(SESSION_COOKIE, out.token, sessionCookieOptions(out.expiresAt));
    return { actor: toSessionActor(out.actor, out), expires_at: out.expiresAt.toISOString() };
  }

  /** Idempotente y sin sesión obligatoria: cerrar una sesión ya vencida no es error. */
  @Public()
  @Post(CORE_API_PATHS.logout)
  @HttpCode(204)
  async doLogout(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await this.logout.execute({ token });
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  }

  @Get(CORE_API_PATHS.me)
  async me(@CurrentActor() actor: ActorContext): Promise<MeResponse> {
    const me = await this.getMe.execute({ actor });
    return { actor: toSessionActor(actor, me), organization: me.organization, modules: me.modules, locations: me.locations };
  }
}
