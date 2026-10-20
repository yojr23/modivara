/** Roles por local (DATA-001 §2). Una persona puede tener varios. */
export const LOCATION_ROLES = ['admin', 'staff', 'inventory'] as const;
export type LocationRole = (typeof LOCATION_ROLES)[number];

/** Permisos que verifican los guards. Las rutas nunca preguntan por roles (ADR-002 §3). */
export const PERMISSIONS = [
  'core.users.manage',
  'hospitality.tables.manage',
  'hospitality.calls.read',
  'hospitality.calls.acknowledge',
  'hospitality.calls.complete',
  'hospitality.devices.status',
  'commerce.catalog.manage',
  'commerce.reasons.manage',
  'commerce.stock.read',
  'commerce.stock.write',
  'analytics.calls.read',
  'analytics.inventory.read',
  // OPEN: DATA-001 §2 solo dice "platform.*"; estos nombres concretos están pendientes de revisión.
  'platform.organizations.manage',
  'platform.locations.manage',
  'platform.entitlements.manage',
  'platform.gateways.manage',
  'platform.devices.manage',
  'platform.device_assignments.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Traducción rol → permisos. Dividir `staff` (p. ej. waiter, cashier) es agregar una entrada aquí,
 * sin tocar rutas ni guards.
 */
export const ROLE_PERMISSIONS: Readonly<Record<LocationRole, readonly Permission[]>> = {
  admin: [
    'core.users.manage',
    'hospitality.tables.manage',
    'hospitality.calls.read',
    'hospitality.calls.acknowledge',
    'hospitality.calls.complete',
    'hospitality.devices.status',
    'commerce.catalog.manage',
    'commerce.reasons.manage',
    'commerce.stock.read',
    'commerce.stock.write',
    'analytics.calls.read',
    'analytics.inventory.read',
  ],
  staff: ['hospitality.calls.read', 'hospitality.calls.acknowledge', 'hospitality.calls.complete', 'hospitality.devices.status'],
  inventory: ['commerce.catalog.manage', 'commerce.stock.read', 'commerce.stock.write', 'analytics.inventory.read'],
};

export interface PermissionContext {
  /** Dueño del negocio: admin en todos sus locales (DATA-001 §2). */
  isOwner: boolean;
  /** Usuario de la organización de plataforma: superadmin (ADR-002 D3). */
  isPlatform: boolean;
}

/** Permisos efectivos de un usuario en un local. */
export function permissionsFor(roles: readonly LocationRole[], { isOwner, isPlatform }: PermissionContext): ReadonlySet<Permission> {
  if (isPlatform) return new Set(PERMISSIONS);
  const effective = isOwner ? [...roles, 'admin' as const] : roles;
  return new Set(effective.flatMap((role) => ROLE_PERMISSIONS[role]));
}
