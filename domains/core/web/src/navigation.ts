import type { MeResponse, ModuleName } from '@modivara/core-contracts';

/** Módulos que la navegación puede mostrar: solo los habilitados al negocio. La autorización real la decide el backend. */
export function visibleModules(me: MeResponse): ModuleName[] {
  return me.modules;
}

/** Locales a los que accede el usuario. */
export function visibleLocations(me: MeResponse): MeResponse['locations'] {
  return me.locations;
}

export const isModuleEnabled = (me: MeResponse, module: ModuleName): boolean => me.modules.includes(module);
