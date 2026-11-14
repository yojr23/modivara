import type { SaleStatus } from '@modivara/pos-contracts';
import type { Sale } from '../domain/sale.js';
import type { SellableItem } from '../domain/sellable-item.js';

/** Quién, en qué negocio y en qué local; viene del contexto autorizado en el servidor, nunca del cliente. */
export interface PosContext {
  organizationId: string;
  locationId: string;
  actorUserId: string;
}

export interface LocationScope {
  organizationId: string;
  locationId: string;
}

/** Toda búsqueda va acotada por negocio y local: un id de otro sitio no existe. */
export interface ScopedId extends LocationScope {
  id: string;
}

export interface SellableItemRepository {
  /** Nombre o SKU repetido entre activos del local → `ConflictError` (lo garantiza la base, no una lectura previa). */
  save(item: SellableItem): Promise<void>;
  findById(query: ScopedId): Promise<SellableItem | null>;
  /** Activos e inactivos (para resolver nombres en el historial), por nombre. */
  list(query: LocationScope): Promise<SellableItem[]>;
  /** Sin distinguir mayúsculas, solo activos. */
  findActiveByName(query: LocationScope & { name: string }): Promise<SellableItem | null>;
  findActiveBySku(query: LocationScope & { sku: string }): Promise<SellableItem | null>;
}

/** Clave de idempotencia de una mutación: `fingerprint` resume la petición para detectar reusos con otro cuerpo. */
export interface IdempotencyKey {
  key: string;
  operation: string;
  fingerprint: string;
}

/** Resultado de una mutación de venta; `replayed` = la clave ya existía y se devuelve el estado actual. */
export interface SaleWrite {
  sale: Sale;
  replayed: boolean;
}

/** Recurso de otro producto al que se ata una venta abierta; vive fuera del agregado `Sale`. */
export interface ExternalLink {
  provider: string;
  resourceType: string;
  resourceId: string;
}

/**
 * Persistencia de ventas con concurrencia e idempotencia (POS-14, POS-18). Cada escritura es atómica:
 * venta, líneas, eventos de outbox, clave de idempotencia y vínculos externos van en la misma transacción.
 */
export interface SaleStore {
  /**
   * Inserta la venta nueva (+ vínculo activo opcional) y su clave. Misma clave y misma petición → la venta original (`replayed`);
   * misma clave con otra operación o petición → `IdempotencyKeyReusedError`; recurso ya vinculado → la venta vinculada (`replayed`),
   * y la clave queda atada a ella. La venta de una clave se busca siempre dentro del negocio y local de la petición.
   */
  open(sale: Sale, idem: IdempotencyKey | null, link?: ExternalLink): Promise<SaleWrite>;
  /**
   * Bloquea la venta (si no es del negocio y local → `NotFoundError`), revisa la clave (repetición o reuso), aplica `work`
   * y guarda venta, líneas, eventos y clave; si la venta ya no está abierta, desactiva sus vínculos. Todo o nada.
   */
  mutate(query: ScopedId, idem: IdempotencyKey, work: (sale: Sale) => void): Promise<SaleWrite>;
  /**
   * Resultado ya confirmado para la clave: misma operación y petición → la venta en su estado actual (`replayed`); otra →
   * `IdempotencyKeyReusedError`; clave nueva → null. Permite responder un reintento sin repetir validaciones externas.
   */
  findReplay(query: LocationScope, idem: IdempotencyKey): Promise<SaleWrite | null>;
  findById(query: ScopedId): Promise<Sale | null>;
  findByActiveLink(query: LocationScope & ExternalLink): Promise<Sale | null>;
  /** Más recientes primero por (opened_at desc, id desc); `after` = cursor de la última fila de la página anterior. */
  list(query: LocationScope & { status?: SaleStatus; limit: number; after?: { openedAt: Date; id: string } }): Promise<Sale[]>;
}

/** Moneda por local (POS-09); sin fila, el caso de uso aplica la moneda por defecto. */
export interface PosSettingsRepository {
  findCurrency(query: LocationScope): Promise<string | null>;
  saveCurrency(query: LocationScope & { currency: string; actorUserId: string }): Promise<void>;
}

/**
 * Adaptador que registra el host por proveedor (POS-15, POS-27): confirma que el recurso externo existe y es visible
 * para el actor. POS nunca conoce al proveedor; uno no registrado equivale a un recurso inexistente.
 */
export interface ExternalReferenceValidator {
  readonly provider: string;
  validate(ctx: PosContext, resourceType: string, resourceId: string): Promise<boolean>;
}
