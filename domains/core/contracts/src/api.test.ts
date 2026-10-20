import { describe, expect, it } from 'vitest';
import { meResponseSchema } from './api.js';

const id = '0192d4f0-0000-7000-8000-000000000001';

describe('meResponseSchema', () => {
  it('acepta la sesión de un admin con un local', () => {
    const me = {
      actor: { user_id: id, organization_id: id, username: 'admin', display_name: 'Admin', is_owner: true, is_platform: false, acting_organization_id: null },
      organization: { id, slug: 'bar-demo', name: 'Bar Demo' },
      modules: ['hospitality', 'commerce'],
      locations: [{ id, name: 'Principal', timezone: 'America/Bogota', permissions: ['hospitality.calls.read'] }],
    };
    expect(meResponseSchema.parse(me)).toEqual(me);
  });

  it('rechaza permisos o módulos inventados', () => {
    expect(meResponseSchema.safeParse({ actor: {}, organization: null, modules: ['pos'], locations: [] }).success).toBe(false);
  });
});
