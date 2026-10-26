import type { AuditLog } from './audit-log.js';
import type { OutboxAppender } from './outbox.js';
import type {
  EntitlementRepository, LocationRepository, MembershipRepository, OrganizationRepository, SessionRepository, UserRepository,
} from './repositories.js';

/**
 * Repositorios ligados a una misma transacción: solo los que usan las operaciones administrativas.
 * DATA-001 §2: la auditoría y el outbox (§6) se escriben en la misma transacción que el cambio.
 */
export interface AdminTransaction {
  organizations: OrganizationRepository;
  locations: LocationRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  sessions: SessionRepository;
  entitlements: EntitlementRepository;
  audit: AuditLog;
  outbox: OutboxAppender;
}

/**
 * Puerto transaccional acotado (TECH-001 §5 v1.4), no un UnitOfWork genérico: si `work` lanza, nada queda.
 * No hacer dentro trabajo ajeno a la base (correo, HTTP).
 */
export interface AdminTransactions {
  withTransaction<T>(work: (tx: AdminTransaction) => Promise<T>): Promise<T>;
}
