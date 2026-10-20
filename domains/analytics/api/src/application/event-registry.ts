import {
  stockAdjustedV1,
  stockIssuedV1,
  stockReceivedV1,
  STOCK_EVENT_TYPES,
  type StockEventPayload,
  type MovementDirection,
} from '@modivara/commerce-contracts';
import {
  HOSPITALITY_EVENT_TYPES,
  serviceCallAcknowledgedEventSchema,
  serviceCallCompletedEventSchema,
  serviceCallCreatedEventSchema,
} from '@modivara/hospitality-contracts';
import { EventOutOfOrderError, ServiceCallFact, StockMovementFact } from '../domain/index.js';
import type { ServiceCallFactRepository, StockMovementFactRepository } from './ports/index.js';
import type { Parser } from './support.js';

interface TenantEvent {
  event_id: string;
  organization_id: string;
  location_id: string;
}

/** Cómo se proyecta un `event_type`: su esquema (valida sobre y payload una sola vez) y su efecto. */
export interface RegistryEntry {
  schema: Parser<TenantEvent>;
  apply(event: TenantEvent): Promise<void>;
}

/** Único lugar que decide qué eventos entiende Analytics: lo que no está aquí se ignora. */
export type EventRegistry = ReadonlyMap<string, RegistryEntry>;

const entry = <T extends TenantEvent>(schema: Parser<T>, apply: (event: T) => Promise<void>): RegistryEntry =>
  ({ schema, apply }) as RegistryEntry;

export function buildEventRegistry(calls: ServiceCallFactRepository, stocks: StockMovementFactRepository): EventRegistry {
  /** `acknowledged`/`completed` solo tienen sentido sobre un fact creado. */
  const existing = async (e: TenantEvent, serviceCallId: string): Promise<ServiceCallFact> => {
    const fact = await calls.findById(serviceCallId);
    // OPEN: política de dead-letter tras N reintentos de un evento fuera de orden (no decidida); hoy el poller reintenta sin tope.
    if (!fact) throw new EventOutOfOrderError(`service call ${serviceCallId} has not been created yet`);
    fact.assertTenant(e.organization_id, e.location_id);
    return fact;
  };
  const stock = (direction: MovementDirection, schema: Parser<TenantEvent & { payload: StockEventPayload }>) =>
    entry(schema, (e) =>
      stocks.save(
        StockMovementFact.create({ organizationId: e.organization_id, locationId: e.location_id, direction, payload: e.payload }),
      ),
    );

  return new Map<string, RegistryEntry>([
    [
      HOSPITALITY_EVENT_TYPES.serviceCallCreated,
      entry(serviceCallCreatedEventSchema, async (e) => {
        const current = await calls.findById(e.payload.service_call_id);
        if (current) return current.assertTenant(e.organization_id, e.location_id); // reentrega con otro event_id: nada que cambiar
        await calls.save(ServiceCallFact.create({ organizationId: e.organization_id, locationId: e.location_id }, e.payload));
      }),
    ],
    [
      HOSPITALITY_EVENT_TYPES.serviceCallAcknowledged,
      entry(serviceCallAcknowledgedEventSchema, async (e) => {
        const fact = await existing(e, e.payload.service_call_id);
        fact.applyAcknowledged(e.payload);
        await calls.save(fact);
      }),
    ],
    [
      HOSPITALITY_EVENT_TYPES.serviceCallCompleted,
      entry(serviceCallCompletedEventSchema, async (e) => {
        const fact = await existing(e, e.payload.service_call_id);
        fact.applyCompleted(e.payload);
        await calls.save(fact);
      }),
    ],
    [STOCK_EVENT_TYPES.in, stock('in', stockReceivedV1)],
    [STOCK_EVENT_TYPES.out, stock('out', stockIssuedV1)],
    [STOCK_EVENT_TYPES.adjust, stock('adjust', stockAdjustedV1)],
  ]);
}
