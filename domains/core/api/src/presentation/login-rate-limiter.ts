import { Injectable } from '@nestjs/common';
import { TooManyRequestsError } from './domain-exception.filter.js';

// OPEN: valores del límite por IP del login (TECH-001 §16.3: "más límite por IP", sin cifras). Una tablet de barra
// y varios meseros comparten la IP del local, por eso el máximo es holgado.
export const LOGIN_IP_MAX_ATTEMPTS = 30;
export const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;

/**
 * Ventana fija por IP, en memoria. Cada intento reserva un cupo antes de verificar la contraseña (así una ráfaga
 * simultánea no pasa entera) y un login correcto lo devuelve: el personal de un bar comparte IP.
 * OPEN: almacenamiento del límite (TECH-001 §16.3 "pendiente"); la API corre en un solo proceso.
 */
@Injectable()
export class LoginRateLimiter {
  // ponytail: Map en memoria de un solo proceso; con varias instancias o reinicios frecuentes pasar a PostgreSQL/Redis.
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  /** Reserva un intento (síncrono, antes de cualquier await); lanza `TooManyRequestsError` si la ventana está llena. */
  hit(ip: string, now = Date.now()): void {
    for (const [key, w] of this.windows) if (now - w.startedAt >= LOGIN_IP_WINDOW_MS) this.windows.delete(key);
    const w = this.windows.get(ip) ?? { startedAt: now, count: 0 };
    if (w.count >= LOGIN_IP_MAX_ATTEMPTS) throw new TooManyRequestsError(Math.ceil((w.startedAt + LOGIN_IP_WINDOW_MS - now) / 1000));
    w.count++;
    this.windows.set(ip, w);
  }

  /** Login correcto: devuelve el intento reservado. */
  refund(ip: string): void {
    const w = this.windows.get(ip);
    if (w && w.count > 0) w.count--;
  }
}
