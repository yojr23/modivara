// ponytail: ventana fija de 3 s; calibrar con el hardware real (DATA-001 §3, TECH-001 §16.4).
export const DEBOUNCE_WINDOW_MS = 3_000;

/** `lastPressAt` es la última pulsación contada (call_created/repeat_press) de la misma señal. */
export function isDebounced(lastPressAt: Date | null, now: Date, windowMs: number = DEBOUNCE_WINDOW_MS): boolean {
  return lastPressAt !== null && now.getTime() - lastPressAt.getTime() < windowMs;
}
