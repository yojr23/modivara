import { Device } from '../../domain/devices/device.js';
import { DuplicateError } from '../../domain/errors.js';
import type { ById, DeviceRepository, Scope } from '../../application/ports/index.js';
import { mapUnique, type Db } from './db.js';

const toDomain = (r: { id: string; organizationId: string; locationId: string; code: string; model: string | null; createdAt: Date; createdBy: string | null; deactivatedAt: Date | null }) =>
  Device.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, code: r.code, model: r.model,
    createdAt: r.createdAt, createdBy: r.createdBy, deactivatedAt: r.deactivatedAt,
  });

export class PrismaDeviceRepository implements DeviceRepository {
  constructor(private readonly db: Db) {}

  async findById({ id, organizationId, locationId }: ById) {
    const r = await this.db.device.findFirst({ where: { id, organizationId, locationId } });
    return r && toDomain(r);
  }

  /** El código se compara tal cual: lo envía el hardware (DATA-001: `uq_devices_code` sin `lower`). */
  async findActiveByCode({ code, organizationId, locationId }: Scope & { code: string }) {
    const r = await this.db.device.findFirst({ where: { organizationId, locationId, code, deactivatedAt: null } });
    return r && toDomain(r);
  }

  save(device: Device) {
    const p = device.toProps();
    const data = { model: p.model, deactivatedAt: p.deactivatedAt };
    return mapUnique(
      async () =>
        void (await this.db.device.upsert({
          where: { id: p.id },
          create: { id: p.id, organizationId: p.organizationId, locationId: p.locationId, code: p.code, createdAt: p.createdAt, createdBy: p.createdBy, ...data },
          update: data,
        })),
      () => new DuplicateError('device'),
    );
  }
}
