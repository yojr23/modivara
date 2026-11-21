import type { ProjectionResult } from '../support.js';

/** Emisores que analytics proyecta; su nombre es el prefijo de sus `event_type` (`hospitality.`, `commerce.`). */
export const ANALYTICS_SOURCES = ['hospitality', 'commerce'] as const;
export type AnalyticsSource = (typeof ANALYTICS_SOURCES)[number];

/** Proyector ligado a una transacción: todo lo que escribe se confirma o se revierte junto. */
export interface Projector {
  /** Vacía solo los hechos de `sources` y sus eventos procesados; lo de las demás fuentes queda intacto. */
  clear(sources: readonly AnalyticsSource[]): Promise<void>;
  project(event: unknown): Promise<ProjectionResult>;
}

/** Ejecuta `work` en UNA transacción de analytics: si lanza, nada cambia; los eventos en vivo esperan a que termine. */
export interface ProjectionTransaction {
  run<T>(work: (projector: Projector) => Promise<T>): Promise<T>;
}
