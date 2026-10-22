import { type CoreAccessPort, idParamSchema, ValidationError } from '@modivara/core-contracts';
import type { ServiceCallDto } from '@modivara/hospitality-contracts';
import { canSeeCall } from '../domain/service-calls/visibility.js';
import { type CallViews } from './call-view.js';
import type { CallListQuery, LocationSettingsRepository, ServiceCallRepository } from './ports/index.js';
import { type PermittedContext, requireActiveLocation, scopeOf } from './support.js';

export interface ListServiceCallsInput extends PermittedContext {
  status: CallListQuery['status'];
  tableId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

export interface ServiceCallPageView {
  items: ServiceCallDto[];
  nextCursor: string | null;
}

export const encodeCursor = (c: { createdAt: Date; id: string }): string => Buffer.from(JSON.stringify([c.createdAt.toISOString(), c.id])).toString('base64url');

export function decodeCursor(raw: string): { createdAt: Date; id: string } {
  try {
    const [iso, id] = JSON.parse(Buffer.from(raw, 'base64url').toString()) as [unknown, unknown];
    const createdAt = new Date(String(iso));
    // Un cursor nunca apunta antes de 2000 ni al futuro: fuera de rango, la base respondería 500 (fecha inválida) en vez de 400.
    const inRange = createdAt.getTime() >= Date.UTC(2000, 0, 1) && createdAt.getTime() <= Date.now() + 86_400_000;
    if (typeof iso === 'string' && inRange && idParamSchema.safeParse(id).success) return { createdAt, id: id as string };
  } catch {
    // cae al error de validación
  }
  throw new ValidationError('cursor: invalid');
}

/** Tablero (`active`) e historial paginado por cursor estable `(created_at, id)`. Todo pasa por `canSeeCall`. */
export class ListServiceCalls {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly calls: ServiceCallRepository,
    private readonly views: CallViews,
    private readonly settings: LocationSettingsRepository,
  ) {}

  async execute(input: ListServiceCallsInput): Promise<ServiceCallPageView> {
    await requireActiveLocation(this.core, input);
    const scope = scopeOf(input);
    const { callVisibility } = await this.settings.get(scope);
    const rows = await this.calls.list(scope, {
      status: input.status,
      ...(input.tableId && { tableId: input.tableId }),
      ...(input.from && { from: input.from }),
      ...(input.to && { to: input.to }),
      ...(input.cursor && { after: decodeCursor(input.cursor) }),
      limit: input.limit + 1,
    });
    const page = rows.slice(0, input.limit);
    // El cursor avanza por lo leído, no por lo visible: así un filtro de visibilidad no deja páginas atascadas.
    const last = page.at(-1);
    return {
      items: await this.views.many(scope, page.filter((c) => canSeeCall(input, c, callVisibility))),
      nextCursor: rows.length > input.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }
}
