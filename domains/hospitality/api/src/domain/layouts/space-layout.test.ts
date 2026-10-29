import { describe, expect, it } from 'vitest';
import type { LayoutElement } from '@modivara/hospitality-contracts';
import { InvalidStateError, SpaceLayout, validateLayoutContent, ValidationError } from '../index.js';

const uid = () => crypto.randomUUID();
const now = new Date('2026-10-28T10:00:00Z');
const box = { x: 10, y: 20, width: 40, height: 40, rotation: 0 };
const table = (over: Partial<Extract<LayoutElement, { type: 'table' }>> = {}): LayoutElement => ({ id: uid(), type: 'table', table_id: uid(), shape: 'round', ...box, ...over });
const canvas = { canvasWidth: 800, canvasHeight: 600 };
const check = (elements: LayoutElement[], c = canvas) => () => validateLayoutContent({ ...c, elements });

describe('validateLayoutContent', () => {
  it('acepta los cinco tipos de elemento, incluso superpuestos', () => {
    const elements: LayoutElement[] = [
      table(), table({ x: 12 }), { id: uid(), type: 'wall', ...box }, { id: uid(), type: 'door', ...box }, { id: uid(), type: 'bar', ...box },
      { id: uid(), type: 'label', text: 'Entrada', x: 0, y: 600, rotation: 359.9 },
    ];
    expect(check(elements)).not.toThrow();
  });

  it('rechaza lienzos fuera de rango o no enteros', () => {
    for (const bad of [0, -5, 10_001, 1.5, NaN]) expect(check([], { canvasWidth: bad, canvasHeight: 600 })).toThrow(ValidationError);
    expect(check([], { canvasWidth: 800, canvasHeight: 0 })).toThrow(ValidationError);
  });

  it('máximo 500 elementos', () => {
    const many = (n: number) => Array.from({ length: n }, () => ({ id: uid(), type: 'wall' as const, ...box }));
    expect(check(many(500))).not.toThrow();
    expect(check(many(501))).toThrow(ValidationError);
  });

  it('números finitos, tamaño positivo y rotación en [0, 360)', () => {
    expect(check([table({ x: Infinity })])).toThrow(ValidationError);
    expect(check([table({ y: NaN })])).toThrow(ValidationError);
    expect(check([table({ width: 0 })])).toThrow(ValidationError);
    expect(check([table({ height: -1 })])).toThrow(ValidationError);
    expect(check([table({ rotation: 360 })])).toThrow(ValidationError);
    expect(check([table({ rotation: -1 })])).toThrow(ValidationError);
  });

  it('posición dentro del lienzo (bordes incluidos)', () => {
    expect(check([table({ x: 800, y: 600 }), table({ x: 0, y: 0 })])).not.toThrow();
    expect(check([table({ x: 801 })])).toThrow(ValidationError);
    expect(check([table({ y: -0.1 })])).toThrow(ValidationError);
  });

  it('rótulo de hasta 60 caracteres', () => {
    const label = (text: string): LayoutElement => ({ id: uid(), type: 'label', text, x: 1, y: 1, rotation: 0 });
    expect(check([label('x'.repeat(60))])).not.toThrow();
    expect(check([label('x'.repeat(61))])).toThrow(ValidationError);
  });

  it('una mesa no puede repetirse ni repetirse el id del elemento', () => {
    const tableId = uid();
    expect(check([table({ table_id: tableId }), table({ table_id: tableId })])).toThrow(/twice/);
    const id = uid();
    expect(check([table({ id }), table({ id })])).toThrow(/Duplicate/);
  });
});

describe('SpaceLayout', () => {
  const draft = () => SpaceLayout.createDraft({ organizationId: uid(), locationId: uid(), zoneId: null, createdBy: 'u1', now, ...canvas, elements: [table()] });

  it('el borrador nace en versión 0, revisión 1, y cada reemplazo sube la revisión', () => {
    const d = draft();
    expect(d).toMatchObject({ status: 'draft', version: 0, revision: 1 });
    d.replaceContent({ ...canvas, elements: [] }, 'u2', now);
    expect(d.revision).toBe(2);
    expect(() => d.replaceContent({ ...canvas, elements: [table({ x: 9999 })] }, 'u2', now)).toThrow(ValidationError);
    expect(d.revision).toBe(2);
  });

  it('publicar fija versión y autor; un publicado ya no se edita ni se publica de nuevo', () => {
    const d = draft();
    d.publish(3, 'u3', now);
    expect(d.toProps()).toMatchObject({ status: 'published', version: 3, publishedBy: 'u3', publishedAt: now });
    expect(() => d.replaceContent({ ...canvas, elements: [] }, 'u3', now)).toThrow(InvalidStateError);
    expect(() => d.publish(4, 'u3', now)).toThrow(InvalidStateError);
  });

  it('tableIds lista solo las mesas', () => {
    const t = table();
    const d = SpaceLayout.createDraft({ organizationId: uid(), locationId: uid(), zoneId: null, createdBy: 'u', now, ...canvas, elements: [t, { id: uid(), type: 'bar', ...box }] });
    expect(d.tableIds).toEqual([(t as { table_id: string }).table_id]);
  });
});
