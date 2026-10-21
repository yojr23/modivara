import { ConcurrencyConflictError } from '../../domain/errors.js';
import type { ServiceCall } from '../../domain/service-calls/service-call.js';
import type { ById, Scope, ServiceCallRepository } from '../../application/ports/index.js';
import type { HospitalityPrisma } from './client.js';
import { isUniqueViolation } from './db.js';
import { persistTransitionsAndOutbox, toServiceCall } from './service-call-persistence.js';

const ACTIVE = ['pending', 'in_progress'] as const;

export class PrismaServiceCallRepository implements ServiceCallRepository {
  constructor(private readonly db: HospitalityPrisma) {}

  async findById({ id, organizationId, locationId }: ById) {
    const r = await this.db.serviceCall.findFirst({ where: { id, organizationId, locationId } });
    return r && toServiceCall(r);
  }

  /** Más antiguas primero (tablero). */
  async listActive({ organizationId, locationId }: Scope) {
    const rows = await this.db.serviceCall.findMany({
      where: { organizationId, locationId, status: { in: [...ACTIVE] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toServiceCall);
  }

  async save(call: ServiceCall) {
    const p = call.toProps();
    try {
      await this.db.$transaction(async (tx) => {
        if (call.persistedStatus === null) {
          await tx.serviceCall.create({ data: p });
        } else {
          // Optimista: solo cambia si sigue en el estado leído (DATA-001 "Reconocer y finalizar").
          // press_count y last_press_at son de las pulsaciones concurrentes (upsert atómico): no se pisan.
          const { count } = await tx.serviceCall.updateMany({
            where: { id: p.id, organizationId: p.organizationId, locationId: p.locationId, status: call.persistedStatus },
            data: {
              status: p.status, acknowledgedAt: p.acknowledgedAt, acknowledgedBy: p.acknowledgedBy,
              completedAt: p.completedAt, completedBy: p.completedBy, updatedAt: p.updatedAt,
            },
          });
          if (count === 0) throw new ConcurrencyConflictError(null);
        }
        await persistTransitionsAndOutbox(tx, call);
      });
    } catch (e) {
      if (e instanceof ConcurrencyConflictError || isUniqueViolation(e)) {
        // Ya con la transacción deshecha: el estado actual va en el error para que el borde responda 409.
        const current = isUniqueViolation(e)
          ? await this.db.serviceCall.findFirst({ where: { tableId: p.tableId, callType: p.callType, status: { in: [...ACTIVE] } } })
          : await this.db.serviceCall.findFirst({ where: { id: p.id } });
        throw new ConcurrencyConflictError(current && toServiceCall(current));
      }
      throw e;
    }
  }
}
