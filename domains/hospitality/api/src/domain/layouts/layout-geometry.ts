import type { LayoutElement } from '@modivara/hospitality-contracts';
import { ValidationError } from '../errors.js';

type Sized = Exclude<LayoutElement, { type: 'label' }>;
const sized = (e: LayoutElement): e is Sized => e.type !== 'label';

// OPEN: ¿las cajas deben tener en cuenta la rotación? Hoy no: es el mismo criterio que el editor del portal
// (editor-kit.tsx: `outside` y `areaOverlap` usan x/y/width/height sin girar), para no rechazar aquí lo que el editor da por válido.
const intersects = (a: Sized, b: Sized) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Elementos con tamaño cuya caja se sale por la derecha o abajo (izquierda/arriba ya lo impide el ancla). Las etiquetas no tienen caja. */
export function elementsOutsideCanvas(elements: LayoutElement[], canvasWidth: number, canvasHeight: number): Sized[] {
  return elements.filter(sized).filter((e) => e.x + e.width > canvasWidth || e.y + e.height > canvasHeight);
}

/** Pares de áreas cuyas cajas se solapan (tocarse por el borde no cuenta). */
export function overlappingAreas(elements: LayoutElement[]): [Sized, Sized][] {
  const areas = elements.filter((e) => e.type === 'area') as Sized[];
  return areas.flatMap((a, i) => areas.slice(i + 1).filter((b) => intersects(a, b)).map((b): [Sized, Sized] => [a, b]));
}

/**
 * Reglas para PUBLICAR (el borrador puede guardarse incompleto, como permite el editor).
 * OPEN: ¿se permiten áreas superpuestas? Se rechazan: con solape la pertenencia de una mesa a un área deja de ser unívoca.
 */
export function assertPublishable({ canvasWidth, canvasHeight, elements }: { canvasWidth: number; canvasHeight: number; elements: LayoutElement[] }): void {
  if (elementsOutsideCanvas(elements, canvasWidth, canvasHeight).length) throw new ValidationError('Element lies outside the canvas');
  if (overlappingAreas(elements).length) throw new ValidationError('Areas must not overlap');
}
