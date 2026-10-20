import type { MeResponse } from '@modivara/core-contracts';

const ORG = '11111111-1111-4111-8111-111111111111';
export const LOC = '22222222-2222-4222-8222-222222222222';

export const makeMe = (over: Partial<MeResponse> = {}): MeResponse => ({
  actor: {
    user_id: '33333333-3333-4333-8333-333333333333', organization_id: ORG, username: 'ana', display_name: 'Ana',
    is_owner: true, is_platform: false, acting_organization_id: null,
  },
  organization: { id: ORG, slug: 'demo', name: 'Demo' },
  modules: ['hospitality'],
  locations: [{ id: LOC, name: 'Centro', timezone: 'America/Bogota', permissions: ['hospitality.calls.read'] }],
  ...over,
});

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
