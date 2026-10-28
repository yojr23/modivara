import type { CallType } from '@modivara/hospitality-contracts';
import type { ServiceCallFactQuery, ServiceCallFactRepository } from '../../application/index.js';
import { ServiceCallFact } from '../../domain/index.js';
import type { Db } from './db.js';
import type { ServiceCallFact as Row } from './generated/client.js';

const toDomain = (r: Row) => ServiceCallFact.restore({ ...r, callType: r.callType as CallType });

export class PrismaServiceCallFactRepository implements ServiceCallFactRepository {
  constructor(private readonly db: Db) {}

  async findById(serviceCallId: string): Promise<ServiceCallFact | null> {
    const row = await this.db.serviceCallFact.findUnique({ where: { serviceCallId } });
    return row && toDomain(row);
  }

  async save(fact: ServiceCallFact): Promise<void> {
    const data = { ...fact.snapshot };
    await this.db.serviceCallFact.upsert({ where: { serviceCallId: data.serviceCallId }, create: data, update: data });
  }

  async findCreatedBetween(q: ServiceCallFactQuery): Promise<ServiceCallFact[]> {
    const rows = await this.db.serviceCallFact.findMany({
      where: {
        organizationId: q.organizationId,
        locationId: q.locationId,
        createdAt: { gte: q.range.from, lt: q.range.to },
        ...(q.zoneId && { zoneId: q.zoneId }),
        ...(q.tableId && { tableId: q.tableId }),
      },
    });
    return rows.map(toDomain);
  }

  async clear(): Promise<void> {
    await this.db.serviceCallFact.deleteMany();
  }
}
