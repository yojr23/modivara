import type { ProjectionResult } from '../support.js';

/** Proyector ligado a una transacción: todo lo que escribe se confirma o se revierte junto. */
export interface Projector {
  /** Vacía las tres tablas de analytics (facts y eventos procesados). */
  clear(): Promise<void>;
  project(event: unknown): Promise<ProjectionResult>;
}

/** Ejecuta `work` en UNA transacción de analytics: si lanza, nada cambia; los eventos en vivo esperan a que termine. */
export interface ProjectionTransaction {
  run<T>(work: (projector: Projector) => Promise<T>): Promise<T>;
}
