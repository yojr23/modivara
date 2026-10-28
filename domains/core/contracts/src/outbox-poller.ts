import { toEventEnvelope } from './domain-event.js';
import type { IntegrationEvent, IntegrationEventSubscriber } from './integration.js';

/** Lo mínimo que el poller usa del cliente Prisma (estructural: core-contracts no depende de Prisma ni de Nest). */
export interface OutboxSql {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}
export interface OutboxDb extends OutboxSql {
  $transaction<T>(fn: (tx: OutboxSql) => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T>;
}
export interface OutboxLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface OutboxPollerOptions {
  /** Pausa entre ciclos. */
  intervalMs: number;
  /** Tiempo máximo de entrega de UN evento a UN suscriptor; vencido cuenta como fallo (con espera creciente). */
  deliveryTimeoutMs: number;
  /** Espera tras el primer fallo; se duplica en cada intento hasta `maxBackoffMs`. */
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** Tras tantos intentos fallidos el evento queda con `failed_at` y el poller deja de tomarlo (`retryFailed` lo libera). */
  maxAttempts: number;
}

export const DEFAULT_OUTBOX_OPTIONS: OutboxPollerOptions = {
  intervalMs: 1000, deliveryTimeoutMs: 5000, baseBackoffMs: 1000, maxBackoffMs: 5 * 60_000, maxAttempts: 10,
};

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

const rowToEvent = (row: OutboxRow): IntegrationEvent =>
  toEventEnvelope({
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

/**
 * Historial completo del outbox (despachados y con `failed_at` incluidos) por orden (occurred_at, id), en páginas con cursor.
 * El cursor viaja como texto para no perder los microsegundos de timestamptz.
 */
export async function* readOutboxHistory(db: OutboxSql, pageSize = 500): AsyncGenerator<IntegrationEvent> {
  let after: { at: string; id: string } | null = null;
  for (;;) {
    const rows: Array<OutboxRow & { cursor_at: string }> = await db.$queryRaw`
      SELECT id, event_type, event_version, occurred_at, organization_id, location_id, aggregate_id, correlation_id, causation_id, payload, attempts,
             occurred_at::text AS cursor_at
      FROM outbox_events
      WHERE ${after?.at ?? null}::timestamptz IS NULL OR (occurred_at, id) > (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid)
      ORDER BY occurred_at, id
      LIMIT ${pageSize}::int`;
    for (const row of rows) yield rowToEvent(row);
    const last = rows.at(-1);
    if (!last || rows.length < pageSize) return;
    after = { at: last.cursor_at, id: last.id };
  }
}

/** Espera tras `attempts` fallos: base, 2×base, 4×base… con tope. */
export const backoffMs = (attempts: number, o: Pick<OutboxPollerOptions, 'baseBackoffMs' | 'maxBackoffMs'>): number =>
  Math.min(o.baseBackoffMs * 2 ** Math.max(0, attempts - 1), o.maxBackoffMs);

/**
 * Libera eventos detenidos por el tope de intentos (todos, o solo `eventId`): `failed_at = NULL, attempts = 0` y vence ya.
 * Conserva `last_error` hasta la próxima entrega exitosa. Devuelve cuántos liberó.
 */
export function retryFailed(db: OutboxSql, eventId?: string): Promise<number> {
  return db.$executeRaw`
    UPDATE outbox_events SET failed_at = NULL, attempts = 0, next_attempt_at = now()
    WHERE failed_at IS NOT NULL AND (${eventId ?? null}::uuid IS NULL OR id = ${eventId ?? null}::uuid)`;
}

/**
 * Transactional Outbox (DATA-001 §6, TECH-001 §9): entrega at-least-once, en el mismo proceso, a los suscriptores de integración.
 * Cada evento se toma con `FOR UPDATE SKIP LOCKED` y se entrega en su PROPIA transacción: los locks de fila hacen que dos pollers
 * (procesos o instancias) nunca entreguen el mismo evento a la vez, y lo ya entregado no se revierte por lo que falle después. Si el proceso
 * cae a mitad de una entrega, la transacción se revierte y el evento se vuelve a entregar al reiniciar, por eso los suscriptores deduplican por `event_id`.
 * Tras `maxAttempts` fallos marca `failed_at` y no lo vuelve a tomar. Nunca borra filas. Con cero suscriptores marca igual `dispatched_at`.
 */
export class OutboxPoller {
  private readonly options: OutboxPollerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private readonly db: OutboxDb;
  private readonly subscribers: readonly IntegrationEventSubscriber[];
  private readonly logger: OutboxLogger;

  constructor(db: OutboxDb, subscribers: readonly IntegrationEventSubscriber[] = [], options: Partial<OutboxPollerOptions> = {}, logger: OutboxLogger = console) {
    this.db = db;
    this.subscribers = subscribers;
    this.logger = logger;
    this.options = { ...DEFAULT_OUTBOX_OPTIONS, ...options };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
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
          WHERE dispatched_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
          ORDER BY next_attempt_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`;
        if (!row) return false;
        try {
          await this.deliver(row);
          await tx.$executeRaw`UPDATE outbox_events SET dispatched_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ${row.id}::uuid`;
        } catch (e) {
          const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
          const attempt = row.attempts + 1;
          const seconds = backoffMs(attempt, this.options) / 1000;
          const giveUp = attempt >= this.options.maxAttempts;
          this.logger.warn(`Evento ${row.id} (${row.event_type}) falló (intento ${attempt}${giveUp ? ', se detiene' : ''}): ${message}`);
          await tx.$executeRaw`
            UPDATE outbox_events
            SET attempts = ${attempt}::int, last_error = ${message}, next_attempt_at = now() + make_interval(secs => ${seconds}::double precision),
                failed_at = CASE WHEN ${giveUp}::boolean THEN now() END
            WHERE id = ${row.id}::uuid`;
        }
        return true;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const event = rowToEvent(row);
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
