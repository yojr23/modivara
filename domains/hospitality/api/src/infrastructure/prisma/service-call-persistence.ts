import type { DomainEvent } from '@modivara/core-contracts';
import { ServiceCall } from '../../domain/service-calls/service-call.js';
import type { Prisma } from './generated/client.js';
import type { Db } from './db.js';

type Row = Awaited<ReturnType<Prisma.TransactionClient['serviceCall']['findFirstOrThrow']>>;

export const toServiceCall = (r: Row) =>
  ServiceCall.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, tableId: r.tableId, callType: r.callType, status: r.status,
    pressCount: r.pressCount, createdAt: r.createdAt, lastPressAt: r.lastPressAt, acknowledgedAt: r.acknowledgedAt,
    acknowledgedBy: r.acknowledgedBy, completedAt: r.completedAt, completedBy: r.completedBy, updatedAt: r.updatedAt,
  });

/** Transiciones y eventos pendientes del agregado, en la transacción `tx` (la misma que escribe el llamado). */
export async function persistTransitionsAndOutbox(tx: Db, call: ServiceCall): Promise<void> {
  const transitions = call.pullTransitions();
  const events = call.pullEvents();
  if (transitions.length > 0) {
    await tx.serviceCallTransition.createMany({
      data: transitions.map((t) => ({ organizationId: call.organizationId, locationId: call.locationId, serviceCallId: call.id, ...t })),
    });
  }
  if (events.length > 0) await tx.outboxEvent.createMany({ data: events.map(outboxRow) });
}

const outboxRow = (e: DomainEvent) => ({
  id: e.eventId,
  eventType: e.eventType,
  eventVersion: e.eventVersion,
  occurredAt: e.occurredAt,
  organizationId: e.organizationId,
  locationId: e.locationId,
  aggregateId: e.aggregateId,
  correlationId: e.correlationId,
  causationId: e.causationId,
  payload: e.payload as Prisma.InputJsonValue,
});
