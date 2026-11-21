import type { CoreAccessPort, Permission, RequestActor } from '@modivara/core-contracts';
import type { ListTables } from '@modivara/hospitality-api';
import { CONTEXT_LABEL_MAX } from '@modivara/pos-contracts';
import { describe, expect, it } from 'vitest';
import { HospitalityTableValidator, tableContextLabel } from './hospitality-pos.js';

describe('tableContextLabel', () => {
  it('antepone la zona y conserva la etiqueta íntegra (zona 60 + mesa 30 = máximo del contrato)', () => {
    expect(tableContextLabel('Mesa 3', null)).toBe('Mesa 3');
    expect(tableContextLabel('5', 'Terraza')).toBe('Terraza · 5');
    const zone = 'Z'.repeat(60);
    const table = 'M'.repeat(30);
    const full = tableContextLabel(table, zone);
    expect(full).toBe(`${zone} · ${table}`);
    expect(full).toHaveLength(CONTEXT_LABEL_MAX);
  });

  it('dos zonas con el mismo prefijo largo y la misma mesa no colisionan', () => {
    const prefix = 'P'.repeat(55);
    expect(tableContextLabel('5', `${prefix}A`)).not.toBe(tableContextLabel('5', `${prefix}B`));
  });
});

describe('HospitalityTableValidator: permiso de vincular', () => {
  const org = '01900000-0000-7000-8000-000000000001';
  const loc = '01900000-0000-7000-8000-000000000002';
  const ctx = { organizationId: org, locationId: loc, actorUserId: '01900000-0000-7000-8000-000000000004' };
  const actor = { organizationId: org, actorUserId: ctx.actorUserId, isOwner: false, isPlatform: false } as unknown as RequestActor;
  const make = (perms: Permission[] | null) => {
    const core = { isModuleEnabled: async () => true, permissionsAt: async () => (perms ? new Set(perms) : null) } as unknown as CoreAccessPort;
    const list = { execute: async () => [{ table: { label: 'Mesa 3' }, zoneName: null }] } as unknown as ListTables;
    return new HospitalityTableValidator(list, core);
  };
  it('con hospitality.tables.link_sale valida la mesa', async () => {
    expect(await make(['hospitality.tables.link_sale']).validate(ctx, 'table', 'x', actor)).toBe('Mesa 3');
  });
  it('sin el permiso, sin actor o con local no resoluble → null (404 uniforme)', async () => {
    expect(await make(['pos.sales.operate', 'hospitality.calls.read']).validate(ctx, 'table', 'x', actor)).toBeNull();
    expect(await make(['hospitality.tables.link_sale']).validate(ctx, 'table', 'x')).toBeNull();
    expect(await make(null).validate(ctx, 'table', 'x', actor)).toBeNull();
  });
});
