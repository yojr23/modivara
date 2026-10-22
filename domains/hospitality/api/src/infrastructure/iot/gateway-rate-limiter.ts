export interface GatewayRateLimitOptions {
  /** Pulsaciones sostenidas por segundo y por gateway. */
  perSecond: number;
  /** Ráfaga máxima (capacidad del cubo). */
  burst: number;
}

// OPEN: ni TECH-001 ni DATA-001 fijan la tasa por gateway. Valores amplios y conservadores para un bar con 20-40 botones
// (aunque todos se pulsen a la vez caben en la ráfaga); ajustar con tráfico real.
export const DEFAULT_GATEWAY_RATE_LIMIT: GatewayRateLimitOptions = { perSecond: 20, burst: 100 };

/** Cada cuánto, como máximo, se avisa en el log de un gateway limitado. */
const LOG_WINDOW_MS = 60_000;

export type RateDecision = 'allow' | 'deny' | 'deny_first';

/**
 * Cubo de fichas por `gateway.id`, compartido por HTTP y MQTT. Se consulta ANTES de trabajo caro (base de datos, JSON, Zod).
 * `deny_first` = primer rechazo de la ventana de log (el llamador registra una vez); `deny` = rechazo silencioso.
 */
// ponytail: en memoria y de un solo proceso; con varias instancias de la API el límite efectivo es por instancia. Subir a Redis si se escala.
export class GatewayRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number; loggedAt: number }>();
  private readonly options: GatewayRateLimitOptions;

  constructor(options: Partial<GatewayRateLimitOptions> = {}) {
    this.options = { ...DEFAULT_GATEWAY_RATE_LIMIT, ...options };
  }

  tryAcquire(gatewayId: string): RateDecision {
    const now = Date.now();
    const { perSecond, burst } = this.options;
    if (this.buckets.size > 10_000) this.sweep(now);
    const b = this.buckets.get(gatewayId) ?? { tokens: burst, at: now, loggedAt: -Infinity };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    this.buckets.set(gatewayId, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 'allow';
    }
    if (now - b.loggedAt < LOG_WINDOW_MS) return 'deny';
    b.loggedAt = now;
    return 'deny_first';
  }

  /** Olvida los cubos ya llenos e inactivos. */
  private sweep(now: number): void {
    for (const [id, b] of this.buckets) if (now - b.at > 60_000) this.buckets.delete(id);
  }
}
