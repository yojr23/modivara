import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { PermissionDeniedError } from '../domain/index.js';
import type { HttpRequest } from './http.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF (TECH-001 §16.3): `SameSite=Strict` + revisión de `Origin` en toda mutación.
 * Sin cabecera `Origin` (clientes que no son navegador: gateway, curl) se deja pasar: no llevan la cookie de otro sitio.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<HttpRequest>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    let host: string | null = null;
    try {
      host = new URL(String(origin)).host;
    } catch {
      /* Origin 'null' u otro valor no válido: se rechaza abajo */
    }
    if (host === null || host !== req.headers.host) throw new PermissionDeniedError('Cross-origin request rejected');
    return true;
  }
}
