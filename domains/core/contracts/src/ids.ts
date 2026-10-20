/**
 * UUIDv7 (RFC 9562) generado en la aplicación: el id se necesita antes de insertar (transiciones, aggregate_id
 * de los eventos). Mismo formato y orden temporal que `uuidv7()` de PostgreSQL 18 (DATA-001 §1).
 * ponytail: sin monotonicidad dentro del mismo milisegundo; agregar contador si el orden fino importa.
 */
export function newId(now: number = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
