import type { LayoutElement } from '@modivara/hospitality-contracts';
import { describe, expect, it } from 'vitest';
import { AMBER_MS, RED_MS, areaTotals, joinAreas, splitAreas, toneOf } from './plan';

describe('toneOf', () => {
  it('separa estado real de urgencia visual (ESP-24, ESP-25)', () => {
    expect(toneOf(undefined, 0)).toBe('idle');
    expect(toneOf('pending', AMBER_MS - 1)).toBe('new');
    expect(toneOf('pending', AMBER_MS)).toBe('waiting');
    expect(toneOf('pending', RED_MS)).toBe('late');
    expect(toneOf('in_progress', RED_MS * 3)).toBe('attending');
  });
});

describe('áreas del plano', () => {
  const t = (id: string, x: number, y: number): LayoutElement => ({ id: `e-${id}`, type: 'table', table_id: id, shape: 'round', x, y, width: 60, height: 60, rotation: 0 });
  const all: LayoutElement[] = [
    { id: 'a1', type: 'area', name: 'Barra', x: 0, y: 0, width: 400, height: 200, rotation: 0 },
    { id: 'a2', type: 'area', name: 'Salón', x: 0, y: 220, width: 400, height: 200, rotation: 0 },
    t('m1', 50, 50), t('m2', 200, 50), t('m3', 50, 300), t('m4', 500, 500),
    { id: 'w', type: 'wall', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
  ];

  it('separa y vuelve a unir sin perder nada (las áreas van primero)', () => {
    const { areas, elements } = splitAreas(all);
    expect(areas.map((a) => [a.name, a.color])).toEqual([['Barra', 0], ['Salón', 1]]);
    expect(elements).toHaveLength(5);
    expect(joinAreas(areas, elements)).toEqual(all);
  });

  it('suma por área las mesas cuyo centro cae dentro; las de afuera no cuentan', () => {
    const { areas, elements } = splitAreas(all);
    const calls: Record<string, number> = { m1: 3, m2: 4, m3: 5, m4: 100 };
    expect(Object.fromEntries(areaTotals(areas, elements, (id) => calls[id] ?? 0))).toEqual({ a1: 7, a2: 5 });
  });
});
