import { describe, expect, it, vi } from 'vitest';
import { ListActiveCalls } from './list-active-calls.js';
import { DEFAULT_LOCATION_SETTINGS } from '../domain/settings/location-settings.js';
import { buildWorld, seedTableWithButton } from '../testing/world.js';

describe('F2-08 location_settings', () => {
  it('sin fila valen los valores por defecto: call_visibility = all', async () => {
    const w = buildWorld();
    expect(await w.settings.get(w.ctx)).toEqual({ callVisibility: 'all' });
    expect(DEFAULT_LOCATION_SETTINGS.callVisibility).toBe('all');
  });

  it('ListActiveCalls lee la visibilidad del local desde el repositorio de ajustes', async () => {
    const w = buildWorld();
    await seedTableWithButton(w);
    await w.registerPress.registerPress(w.press());
    const get = vi.fn(async () => ({ callVisibility: 'all' as const }));
    const list = new ListActiveCalls(w.core, w.calls, w.tables, w.zones, { get });
    const calls = await list.execute({ ...w.ctx, permissions: new Set(['hospitality.calls.read']) });
    expect(calls).toHaveLength(1);
    expect(get).toHaveBeenCalledWith({ organizationId: w.ctx.organizationId, locationId: w.ctx.locationId });
  });
});
