import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type IntegrationEvent, type IntegrationEventSubscriber, toEventEnvelope } from '@modivara/core-contracts';
import type { CommercePrisma } from '../prisma/client.js';

// ponytail: copia del poller de hospitality; extraer cuando haya un tercer emisor
export interface OutboxPollerOptions {
  /** Pausa entre ciclos. */
  intervalMs: number;
  /** Tiempo máximo de entrega de UN evento a UN suscriptor; vencido cuenta como fallo (con espera creciente). */
  deliveryTimeoutMs: number;
  /** Espera tras el primer fallo; se duplica en cada intento hasta `maxBackoffMs`. */
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export const DEFAULT_OUTBOX_OPTIONS: OutboxPollerOptions = { intervalMs: 1000, deliveryTimeoutMs: 5000, baseBackoffMs: 1000, maxBackoffMs: 5 * 60_000 };

/** `OUTBOX_POLL_INTERVAL_MS` configura el intervalo; el resto son valores del poller. */
export function outboxOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): OutboxPollerOptions {
  const interval = Number(env.OUTBOX_POLL_INTERVAL_MS);
  return { ...DEFAULT_OUTBOX_OPTIONS, ...(Number.isFinite(interval) && interval > 0 && { intervalMs: interval }) };
}

interface OutboxRow {
  id: string;
  event_type: string;
  event_version: number;
  occurred_at: Date;
  organization_id: string;
  location_id: string;
  aggregate_id: string;
  correlation_id: string;
  causation_id: string | null;
  payload: unknown;
  attempts: number;
}

/** Espera tras `attempts` fallos: base, 2×base, 4×base… con tope. */
export const backoffMs = (attempts: number, o: Pick<OutboxPollerOptions, 'baseBackoffMs' | 'maxBackoffMs'>): number =>
  Math.min(o.baseBackoffMs * 2 ** Math.max(0, attempts - 1), o.maxBackoffMs);

/**
 * Transactional Outbox (DATA-001 §6, TECH-001 §9): entrega at-least-once, en el mismo proceso, a los suscriptores de integración.
 * Cada evento se toma con `FOR UPDATE SKIP LOCKED` y se entrega en su PROPIA transacción: los locks de fila hacen que dos pollers
 * (procesos o instancias) nunca entreguen el mismo evento a la vez, y lo ya entregado no se revierte por lo que falle después. Si el proceso
 * cae a mitad de una entrega, la transacción se revierte y el evento se vuelve a entregar al reiniciar, por eso los suscriptores deduplican por `event_id`. Nunca borra filas.
 * Con cero suscriptores marca igual `dispatched_at`.
 */
export class OutboxPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('OutboxPoller');
  private readonly options: OutboxPollerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(
    private readonly db: CommercePrisma,
    private readonly subscribers: readonly IntegrationEventSubscriber[] = [],
    options: Partial<OutboxPollerOptions> = {},
  ) {
    this.options = { ...DEFAULT_OUTBOX_OPTIONS, ...options };
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined); // deja terminar el lote en curso antes de que se cierre el cliente
  }

  /** Un ciclo; si hay uno en curso no se solapa y devuelve el mismo. Resuelve con los eventos procesados (entregados o fallidos). */
  tick(): Promise<number> {
    this.running ??= this.pollOnce()
      .catch((e: unknown) => {
        this.logger.error(`Falló el ciclo del outbox: ${e instanceof Error ? e.message : String(e)}`);
        return 0;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** Vacía lo vencido evento a evento y devuelve cuántos eventos procesó (entregados o fallidos). */
  private async pollOnce(): Promise<number> {
    let total = 0;
    while (await this.processOne()) total++;
    return total;
  }

  private async processOne(): Promise<boolean> {
    return this.db.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, event_type, event_version, occurred_at, organization_id, location_id, aggregate_id, correlation_id, causation_id, payload, attempts
          FROM outbox_events
          WHERE dispatched_at IS NULL AND next_attempt_at <= now()
          ORDER BY next_attempt_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`;
        if (!row) return false;
        try {
          await this.deliver(row);
          await tx.$executeRaw`UPDATE outbox_events SET dispatched_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ${row.id}::uuid`;
        } catch (e) {
          const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
          const seconds = backoffMs(row.attempts + 1, this.options) / 1000;
          this.logger.warn(`Evento ${row.id} (${row.event_type}) falló (intento ${row.attempts + 1}): ${message}`);
          await tx.$executeRaw`
            UPDATE outbox_events
            SET attempts = attempts + 1, last_error = ${message}, next_attempt_at = now() + make_interval(secs => ${seconds}::double precision)
            WHERE id = ${row.id}::uuid`;
        }
        return true;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const event: IntegrationEvent = toEventEnvelope({
      eventId: row.id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      occurredAt: row.occurred_at,
      organizationId: row.organization_id,
      locationId: row.location_id,
      aggregateId: row.aggregate_id,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      payload: row.payload,
    });
    for (const subscriber of this.subscribers) {
      if (subscriber.handles(event.event_type)) await this.withTimeout(subscriber.handle(event), subscriber.name);
    }
  }

  /** Un suscriptor que no responde no puede retener la transacción (ni el lock de la fila) indefinidamente. */
  private async withTimeout(delivery: Promise<void>, name: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`El suscriptor ${name} no respondió en ${this.options.deliveryTimeoutMs} ms`)), this.options.deliveryTimeoutMs);
    });
    try {
      await Promise.race([delivery, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
