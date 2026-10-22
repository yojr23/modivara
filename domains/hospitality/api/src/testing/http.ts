import 'reflect-metadata';
import { Catch, Global, HttpException, Injectable, Module, type ArgumentsHost, type CanActivate, type ExceptionFilter, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  CORE_ACCESS_PORT, DomainError, IS_PUBLIC_KEY, LOCATION_ID_PARAM, NotFoundError, REQUEST_ACTOR_KEY, REQUIRED_MODULE_KEY, REQUIRED_PERMISSION_KEY,
  type ModuleName, type Permission, type RequestActor,
} from '@modivara/core-contracts';
import {
  ASSIGNMENTS, CALLS, DEVICE_EVENTS, DEVICES, GATEWAYS, HOSPITALITY_PRISMA, HospitalityModule, SETTINGS, TABLES, ZONES,
} from '../hospitality.module.js';
import {
  FakeCoreAccess, InMemoryDeviceAssignmentRepository, InMemoryDeviceEventRepository, InMemoryDeviceRepository, InMemoryDiningTableRepository,
  InMemoryGatewayRepository, InMemoryLocationSettingsRepository, InMemoryServiceCallRepository, InMemoryZoneRepository,
} from './in-memory.js';

/** Quién hace la petición de prueba, en la cabecera `x-test-actor` (JSON). Sustituye a sesiones y membresías reales de core. */
export interface TestCaller {
  actor: RequestActor;
  /** Permisos por local (lo que core resolvería con las membresías). */
  permissions: Record<string, readonly Permission[]>;
  /** Módulos habilitados del negocio del actor. */
  modules: readonly ModuleName[];
}
export const TEST_ACTOR_HEADER = 'x-test-actor';

class TestAuthError extends DomainError {
  constructor(readonly code: 'session_invalid' | 'permission_denied' | 'module_disabled', message: string) {
    super(message);
  }
}

/**
 * Emula el contrato de los guards globales de core: lee las MISMAS claves de metadato y deja el actor en `request[REQUEST_ACTOR_KEY]`.
 * Superadmin pasa siempre; con `:locationId` el permiso se exige en ese local (un local ajeno responde "no existe"); sin él, en cualquiera.
 */
@Injectable()
export class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const meta = <T>(key: string) => (Reflect.getMetadata(key, context.getHandler()) ?? Reflect.getMetadata(key, context.getClass())) as T | undefined;
    if (meta<boolean>(IS_PUBLIC_KEY)) return true;
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; params: Record<string, string> } & Record<string, unknown>>();
    const raw = req.headers[TEST_ACTOR_HEADER];
    if (!raw) throw new TestAuthError('session_invalid', 'no session');
    const caller = JSON.parse(raw) as TestCaller;
    req[REQUEST_ACTOR_KEY] = caller.actor;
    if (caller.actor.isPlatform) return true;

    const permission = meta<Permission>(REQUIRED_PERMISSION_KEY);
    if (permission) {
      const locationId = req.params[LOCATION_ID_PARAM];
      if (locationId !== undefined) {
        const granted = caller.permissions[locationId];
        if (!granted) throw new NotFoundError('location');
        if (!granted.includes(permission)) throw new TestAuthError('permission_denied', `${permission} required`);
      } else if (!Object.values(caller.permissions).some((p) => p.includes(permission))) {
        throw new TestAuthError('permission_denied', `${permission} required`);
      }
    }
    const module = meta<ModuleName>(REQUIRED_MODULE_KEY);
    if (module && !caller.modules.includes(module)) throw new TestAuthError('module_disabled', `Module ${module} is not enabled`);
    return true;
  }
}

const STATUS: Record<string, number> = { validation: 400, session_invalid: 401, permission_denied: 403, module_disabled: 403, not_found: 404, location_unavailable: 404, conflict: 409 };

/** Misma traducción code -> HTTP que el filtro global de core (ZodError -> 400, DomainError por `code`, resto 500). */
@Catch()
export class TestErrorFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status(c: number): { json(b: unknown): void } }>();
    const code = (e as { code?: unknown } | null)?.code;
    if (e instanceof HttpException) res.status(e.getStatus()).json({ code: `http_${e.getStatus()}`, message: e.message });
    // Errores de body-parser (http-errors), p. ej. 413: llevan `status`. OPEN para core: su filtro global los responde 500.
    else if (typeof (e as { status?: unknown } | null)?.status === 'number' && (e as { status: number }).status < 500) res.status((e as { status: number }).status).json({ code: 'http_error' });
    else if (e instanceof Error && e.name === 'ZodError') res.status(400).json({ code: 'validation' });
    else if (e instanceof Error && typeof code === 'string' && code in STATUS) res.status(STATUS[code]!).json({ code, message: e.message });
    else res.status(500).json({ code: 'internal' });
  }
}

/** HospitalityModule real con repositorios en memoria y el guard/filtro de prueba, en lugar de CoreModule y sus guards globales. */
export async function createHospitalityTestApp() {
  const core = new FakeCoreAccess();
  const devices = new InMemoryDeviceRepository();
  const repos = {
    zones: new InMemoryZoneRepository(),
    tables: new InMemoryDiningTableRepository(),
    devices,
    assignments: new InMemoryDeviceAssignmentRepository(),
    gateways: new InMemoryGatewayRepository(),
    events: new InMemoryDeviceEventRepository(devices),
    settings: new InMemoryLocationSettingsRepository(),
    calls: new InMemoryServiceCallRepository(),
  };

  @Global()
  @Module({ providers: [{ provide: CORE_ACCESS_PORT, useValue: core }], exports: [CORE_ACCESS_PORT] })
  class FakeCoreModule {}

  @Module({
    imports: [FakeCoreModule, HospitalityModule.forRoot({ databaseUrl: 'postgresql://unused' })],
    providers: [{ provide: APP_GUARD, useClass: TestAuthGuard }, { provide: APP_FILTER, useClass: TestErrorFilter }],
  })
  class TestHostModule {}

  const app: INestApplication = (
    await Test.createTestingModule({ imports: [TestHostModule] })
      .overrideProvider(HOSPITALITY_PRISMA).useValue({ $disconnect: async () => undefined })
      .overrideProvider(ZONES).useValue(repos.zones)
      .overrideProvider(TABLES).useValue(repos.tables)
      .overrideProvider(DEVICES).useValue(repos.devices)
      .overrideProvider(ASSIGNMENTS).useValue(repos.assignments)
      .overrideProvider(GATEWAYS).useValue(repos.gateways)
      .overrideProvider(DEVICE_EVENTS).useValue(repos.events)
      .overrideProvider(SETTINGS).useValue(repos.settings)
      .overrideProvider(CALLS).useValue(repos.calls)
      .compile()
  ).createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();

  const http = request(app.getHttpServer());
  const as = (caller: TestCaller) => (grantPermissions(caller), {
    get: (path: string) => http.get(`/api/v1${path}`).set(TEST_ACTOR_HEADER, JSON.stringify(caller)),
    post: (path: string, body?: object, headers: Record<string, string> = {}) => http.post(`/api/v1${path}`).set(TEST_ACTOR_HEADER, JSON.stringify(caller)).set(headers).send(body),
    patch: (path: string, body: object) => http.patch(`/api/v1${path}`).set(TEST_ACTOR_HEADER, JSON.stringify(caller)).send(body),
  });
  // Lo que core resolvería con las membresías: el controlador de llamados pide los permisos por local a `CoreAccessPort.permissionsAt`.
  const grantPermissions = (caller: TestCaller) => {
    for (const [locationId, perms] of Object.entries(caller.permissions)) core.grant(caller.actor.actorUserId, locationId, perms);
  };
  return { app, core, repos, as };
}
