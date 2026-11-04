import { describe, expect, it } from 'vitest';
import type { LayoutElement } from '@modivara/hospitality-contracts';
import { assertPublishable, elementsOutsideCanvas, overlappingAreas, ValidationError } from '../index.js';

const uid = () => crypto.randomUUID();
const area = (x: number, y: number, width: number, height: number, rotation = 0): LayoutElement => ({ id: uid(), type: 'area', name: 'A', x, y, width, height, rotation });
const wall = (x: number, y: number, width: number, height: number, rotation = 0): LayoutElement => ({ id: uid(), type: 'wall', x, y, width, height, rotation });
const check = (elements: LayoutElement[]) => () => assertPublishable({ canvasWidth: 800, canvasHeight: 600, elements });

describe('layout-geometry', () => {
  it('áreas que se solapan se rechazan; tocarse por el borde o estar separadas, no', () => {
    expect(overlappingAreas([area(0, 0, 100, 100), area(50, 50, 100, 100)])).toHaveLength(1);
    expect(check([area(0, 0, 100, 100), area(50, 50, 100, 100)])).toThrow(ValidationError);
    expect(check([area(0, 0, 100, 100), area(100, 0, 100, 100), area(0, 200, 10, 10)])).not.toThrow();
  });

  it('un área contenida en otra también es solape; una pared sobre un área no', () => {
    expect(check([area(0, 0, 300, 300), area(10, 10, 20, 20)])).toThrow(ValidationError);
    expect(check([area(0, 0, 300, 300), wall(10, 10, 20, 20)])).not.toThrow();
  });

  it('la caja de contorno debe caber en el lienzo (borde exacto vale)', () => {
    expect(check([wall(700, 500, 100, 100)])).not.toThrow();
    expect(check([wall(701, 500, 100, 100)])).toThrow(ValidationError);
    expect(check([wall(0, 501, 10, 100)])).toThrow(ValidationError);
  });

  it('las etiquetas no tienen caja: solo cuenta su ancla', () => {
    const label: LayoutElement = { id: uid(), type: 'label', text: 'x', x: 800, y: 600, rotation: 0 };
    expect(elementsOutsideCanvas([label], 800, 600)).toEqual([]);
  });

  it('la rotación no cambia el criterio (igual que el editor del portal)', () => {
    expect(check([wall(700, 500, 100, 100, 45)])).not.toThrow();
    expect(overlappingAreas([area(0, 0, 100, 100, 90), area(50, 0, 100, 100)])).toHaveLength(1);
  });
});
