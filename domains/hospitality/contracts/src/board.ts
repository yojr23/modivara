/** Resaltado por espera (TECH-001 §16.4): constantes visuales, no criterios de aceptación. */
export const BOARD_AMBER_AFTER_MS = 2 * 60_000;
export const BOARD_RED_AFTER_MS = 5 * 60_000;

export type WaitLevel = 'normal' | 'amber' | 'red';

export function waitLevel(elapsedMs: number): WaitLevel {
  if (elapsedMs >= BOARD_RED_AFTER_MS) return 'red';
  if (elapsedMs >= BOARD_AMBER_AFTER_MS) return 'amber';
  return 'normal';
}
