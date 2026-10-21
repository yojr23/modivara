import type { ModuleName } from '@modivara/core-contracts';
import type { AppUser, Entitlement, Location, LocationMembership, Organization, Session } from '../../domain/index.js';

// Toda consulta va acotada por negocio (`organizationId`). Excepciones, que derivan el tenant:
// `OrganizationRepository.findById/findBySlug`, `SessionRepository.findByTokenHash` y `UserRepository.findByIdForSession`.

export interface OrganizationRepository {
  /** Excepción: la organización es la raíz del tenant, su id es el tenant. */
  findById(ref: { id: string }): Promise<Organization | null>;
  /** Excepción: resuelve el tenant a partir del slug del login. */
  findBySlug(ref: { slug: string }): Promise<Organization | null>;
  save(organization: Organization): Promise<void>;
}

/** Local con el estado de su negocio, leídos en una sola consulta (el adaptador hace el JOIN). */
export interface LocationWithOrganization {
  location: Location;
  organizationActive: boolean;
}

export interface LocationRepository {
  findById(ref: { id: string; organizationId: string }): Promise<Location | null>;
  /**
   * Local y estado de su negocio en una sola llamada. Regla única de "local disponible" (D7): local activo Y negocio activo.
   * `organizationId` es opcional solo para `CoreAccessPort.getLocation`, que recibe únicamente el id del local y
   * devuelve su `organizationId` para que quien consulta lo compare; el resto de casos de uso lo pasan siempre.
   */
  findByIdWithOrganization(ref: { id: string; organizationId?: string }): Promise<LocationWithOrganization | null>;
  /** Locales activos del negocio (no mira el estado del negocio: quien llama ya lo resolvió). */
  listActive(ref: { organizationId: string }): Promise<Location[]>;
  save(location: Location): Promise<void>;
}

export interface UserRepository {
  findById(ref: { id: string; organizationId: string }): Promise<AppUser | null>;
  /**
   * Excepción: deriva el tenant. Resuelve el usuario dueño de una sesión (la sesión no guarda el negocio);
   * solo para `AuthenticateSession`.
   */
  findByIdForSession(ref: { id: string }): Promise<AppUser | null>;
  /** Solo usuarios activos: el username es único entre activos (DATA-001). */
  findActiveByUsername(ref: { organizationId: string; username: string }): Promise<AppUser | null>;
  /** Usuarios activos del negocio, por username. */
  listActive(ref: { organizationId: string }): Promise<AppUser[]>;
  /** Todos los usuarios del negocio, también los desactivados (el seed no debe recrearlos). */
  listAll(ref: { organizationId: string }): Promise<AppUser[]>;
  save(user: AppUser): Promise<void>;
  /**
   * Sección crítica del login por usuario: el adaptador abre una transacción, bloquea la fila
   * (`SELECT … FOR UPDATE`), entrega el usuario recién leído (`null` si ya no existe o está desactivado) y
   * confirma al terminar `work`. Así dos fallos simultáneos se cuentan como dos.
   * `work` decide dentro y devuelve el resultado: lanzar haría rollback y perdería el contador, por eso
   * los fallos de credenciales se devuelven y el llamador los lanza fuera.
   */
  withLoginLock<T>(
    ref: { id: string; organizationId: string },
    work: (tx: { user: AppUser | null; save(user: AppUser): Promise<void> }) => Promise<T>,
  ): Promise<T>;
}

export interface MembershipRepository {
  /** Solo membresías activas. */
  findActive(ref: { organizationId: string; userId: string; locationId: string }): Promise<LocationMembership | null>;
  listActiveByUser(ref: { organizationId: string; userId: string }): Promise<LocationMembership[]>;
  save(membership: LocationMembership): Promise<void>;
}

export interface SessionRepository {
  /** La sesión pertenece a un usuario, y el usuario a un negocio: se acota por `userId`. */
  findById(ref: { id: string; userId: string }): Promise<Session | null>;
  /** Excepción: deriva el tenant. Resuelve la sesión del token de la cookie. */
  findByTokenHash(ref: { tokenHash: string }): Promise<Session | null>;
  /**
   * Operaciones dirigidas, no un `save` completo: un `touch` concurrente (cada petición) no debe deshacer una revocación
   * ni el negocio elegido leídos antes. Cada una escribe solo sus columnas.
   */
  create(session: Session): Promise<void>;
  /** Renueva `last_seen_at`/`expires_at`; no toca una sesión ya revocada. */
  touch(session: Session): Promise<void>;
  /** Escribe `revoked_at` (solo si aún no estaba revocada). */
  revoke(session: Session): Promise<void>;
  /** Escribe solo `acting_organization_id`. */
  setActingOrganization(session: Session): Promise<void>;
  /** Revoca todas las sesiones vigentes del usuario (`revoked_at = now`). */
  revokeAllForUser(ref: { organizationId: string; userId: string }, now: Date): Promise<void>;
}

export interface EntitlementRepository {
  listEnabledModules(ref: { organizationId: string }): Promise<ModuleName[]>;
  find(ref: { organizationId: string; module: ModuleName }): Promise<Entitlement | null>;
  save(entitlement: Entitlement): Promise<void>;
}
