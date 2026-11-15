import { MODULES, PERMISSION_SOURCES, type ModuleName, type Permission } from '@modivara/core-contracts';
import { ModuleDisabledError, PermissionDeniedError } from '../domain/index.js';

/**
 * Módulo que le falta a un permiso para ser efectivo: el de su prefijo (si es de un producto de `MODULES`) o su fuente
 * (`PERMISSION_SOURCES`). `core.*` y `platform.*` no dependen de módulos. Un módulo nuevo (p. ej. `pos`) queda cubierto
 * al agregarse a `MODULES`. Regla única de `/me` (navegación) y de los guards/`CoreAccessPort` (autorización).
 */
export function missingModule(permission: Permission, modules: readonly ModuleName[]): ModuleName | null {
  const prefix = permission.split('.')[0] as ModuleName;
  if (MODULES.includes(prefix) && !modules.includes(prefix)) return prefix;
  const source = PERMISSION_SOURCES[permission];
  return source && !modules.includes(source) ? source : null;
}

/** Los permisos concedidos por rol que siguen valiendo con los módulos habilitados del negocio. */
export function effectivePermissions(granted: Iterable<Permission>, modules: readonly ModuleName[]): Set<Permission> {
  return new Set([...granted].filter((p) => !missingModule(p, modules)));
}

/**
 * Sin el permiso por rol → 403 `permission_denied`; con él pero sin su módulo o su fuente → 403 `module_disabled`
 * (p. ej. `analytics.inventory.read` con commerce suspendido).
 */
export function assertEffective(permission: Permission, granted: boolean, modules: readonly ModuleName[]): void {
  if (!granted) throw new PermissionDeniedError(`${permission} required`);
  const missing = missingModule(permission, modules);
  if (missing) throw new ModuleDisabledError(`Module ${missing} is not enabled`);
}
