import type { DomainEvent } from '@modivara/core-contracts';
import type { OutboxAppender } from '../../application/ports/index.js';
import type { Db } from './db.js';
import type { Prisma } from './generated/client.js';

export class PrismaOutbox implements OutboxAppender {
  constructor(private readonly db: Db) {}

  async append(e: DomainEvent) {
    await this.db.outboxEvent.create({
      data: {
        id: e.eventId, eventType: e.eventType, eventVersion: e.eventVersion, occurredAt: e.occurredAt, organizationId: e.organizationId,
        locationId: e.locationId, aggregateId: e.aggregateId, correlationId: e.correlationId, causationId: e.causationId,
        payload: e.payload as Prisma.InputJsonValue,
      },
    });
  }
}
