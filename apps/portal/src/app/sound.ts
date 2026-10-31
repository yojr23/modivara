// F3-13 — alerta sonora opcional del tablero: tono corto con Web Audio (sin archivo de audio).

/** Ids de pendientes que no estaban en `seen`. `seen === null` = primera carga: no suena. */
export const newPendingIds = (seen: ReadonlySet<string> | null, pending: readonly string[]) => (seen ? pending.filter((id) => !seen.has(id)) : []);

const KEY = 'modivara.tablero.sonido';
export const loadSound = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const saveSound = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* sin almacenamiento: no se recuerda */ } };

let ctx: AudioContext | undefined;
/** Crear/reanudar exige un gesto del usuario: llamarlo al activar el interruptor. */
export function prepareAudio() {
  try { ctx ??= new AudioContext(); void ctx.resume(); } catch { /* sin Web Audio */ }
}
export function beep() {
  if (!ctx || ctx.state !== 'running') return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.15, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.2);
}
