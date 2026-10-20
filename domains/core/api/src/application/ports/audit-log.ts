export interface AuditEntry {
  id: string;
  /** Negocio afectado por la acción (no el del actor: el superadmin pertenece a la plataforma). */
  organizationId: string;
  actorUserId: string;
  /** Estable, en `entidad.acción`: `user.created`, `membership.roles_set`… */
  action: string;
  targetType: string;
  targetId: string;
  /** Nunca contraseñas, hashes ni tokens. */
  details: Record<string, unknown>;
  occurredAt: Date;
}

/** Bitácora de acciones administrativas (`core.audit_log`, ADR-002 D3). */
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}
