import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { IS_PUBLIC_KEY, REQUEST_ACTOR_KEY, SESSION_COOKIE } from '@modivara/core-contracts';
import { AuthenticateSession } from '../../application/index.js';
import { SESSION_TTL_MS, SessionInvalidError } from '../../domain/index.js';
import type { HttpRequest, HttpResponse } from '../http.js';
import { sessionCookieOptions } from '../http.js';
import { metadataOf } from './decorators.js';

/** Autenticación por defecto: toda ruta exige sesión salvo las marcadas `@Public()`. Deja el actor en la petición. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthenticateSession) private readonly authenticate: AuthenticateSession) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (metadataOf<boolean>(IS_PUBLIC_KEY, context)) return true;
    const http = context.switchToHttp();
    const req = http.getRequest<HttpRequest>();
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new SessionInvalidError();
    req[REQUEST_ACTOR_KEY] = await this.authenticate.execute({ token });
    // La sesión se desliza 30 días: la cookie se renueva con ella para que expiren a la vez.
    http.getResponse<HttpResponse>().cookie(SESSION_COOKIE, token, sessionCookieOptions(new Date(Date.now() + SESSION_TTL_MS)));
    return true;
  }
}
