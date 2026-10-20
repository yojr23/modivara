import type { AuditEntry, AuditLog } from '../../application/ports/index.js';
import type { Db } from './db.js';
import type { Prisma } from './generated/client.js';

export class PrismaAuditLog implements AuditLog {
  constructor(private readonly db: Db) {}

  async record(e: AuditEntry) {
    await this.db.auditLog.create({
      data: {
        id: e.id, organizationId: e.organizationId, actorUserId: e.actorUserId, action: e.action,
        targetType: e.targetType, targetId: e.targetId, details: e.details as Prisma.InputJsonObject, occurredAt: e.occurredAt,
      },
    });
  }
}
