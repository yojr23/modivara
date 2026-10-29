import type { SpaceLayout } from '../../domain/layouts/space-layout.js';
import type { DiningTable } from '../../domain/tables/dining-table.js';
import type { Scope, ZoneRepository } from './repositories.js';

/** Un espacio = una zona; `zoneId: null` = el espacio por defecto del local. */
export type SpaceScope = Scope & { zoneId: string | null };

/** Lo que se hace dentro de la transacción de publicar (puerto transaccional acotado, como `ButtonPressTx`). */
export interface PublishTx {
  readonly zones: ZoneRepository;
  /** Bloquea (`FOR UPDATE`) el borrador del espacio hasta el commit. Null si no hay (otra publicación ya lo consumió). */
  lockDraft(space: SpaceScope): Promise<SpaceLayout | null>;
  /** Esas mesas del local, con sus filas bloqueadas (`FOR SHARE`): nadie las mueve de zona ni desactiva hasta el commit. */
  lockTables(scope: Scope, ids: string[]): Promise<DiningTable[]>;
  nextVersion(space: SpaceScope): Promise<number>;
  /** Archiva el publicado vigente del espacio y guarda `draft` (ya publicado) en su lugar. */
  savePublished(draft: SpaceLayout): Promise<void>;
}

export interface LayoutRepository {
  findDraft(space: SpaceScope): Promise<SpaceLayout | null>;
  findPublished(space: SpaceScope): Promise<SpaceLayout | null>;
  /** Un publicado por espacio, el de zona nula primero. Incluye espacios de zonas desactivadas: filtrarlas es del caso de uso. */
  listPublished(scope: Scope): Promise<SpaceLayout[]>;
  /**
   * Guarda el borrador solo si la revisión vigente es `expectedRevision` (0 = no hay borrador y se crea).
   * Lanza `LayoutRevisionConflictError` con el borrador vigente si otro lo cambió o lo publicó.
   */
  saveDraft(layout: SpaceLayout, expectedRevision: number): Promise<void>;
  withPublishTx<T>(work: (tx: PublishTx) => Promise<T>): Promise<T>;
}

export interface LayoutPublishedChange {
  organizationId: string;
  locationId: string;
  zoneId: string | null;
  version: number;
}

/** Aviso a la sala del local (Socket.IO) tras publicar un plano. */
export interface LayoutNotifier {
  layoutPublished(change: LayoutPublishedChange): Promise<void>;
}
