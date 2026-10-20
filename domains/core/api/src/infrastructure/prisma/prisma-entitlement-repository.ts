import type { ModuleName } from '@modivara/core-contracts';
import { Entitlement } from '../../domain/index.js';
import type { EntitlementRepository } from '../../application/ports/index.js';
import type { Db } from './db.js';

export class PrismaEntitlementRepository implements EntitlementRepository {
  constructor(private readonly db: Db) {}

  async listEnabledModules({ organizationId }: { organizationId: string }): Promise<ModuleName[]> {
    const rows = await this.db.entitlement.findMany({ where: { organizationId, enabled: true }, orderBy: { module: 'asc' } });
    return rows.map((r) => r.module);
  }

  async find({ organizationId, module }: { organizationId: string; module: ModuleName }) {
    const r = await this.db.entitlement.findUnique({ where: { organizationId_module: { organizationId, module } } });
    return r && Entitlement.restore({ organizationId: r.organizationId, module: r.module, enabled: r.enabled });
  }

  async save(e: Entitlement) {
    await this.db.entitlement.upsert({
      where: { organizationId_module: { organizationId: e.organizationId, module: e.module } },
      create: { organizationId: e.organizationId, module: e.module, enabled: e.enabled },
      update: { enabled: e.enabled },
    });
  }
}
