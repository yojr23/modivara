import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformApi } from './client.js';
import { ME_KEY, dropOtherQueries } from './session.js';

export const platformOrganizationsKey = ['core', 'platform', 'organizations'] as const;

/** Negocios con sus locales para la consola de superadmin. */
export const usePlatformOrganizations = () => useQuery({ queryKey: platformOrganizationsKey, queryFn: platformApi.organizations, retry: false });

/** Cambia el negocio activo del superadmin: descarta cachés de datos (no mezclar negocios) y espera a que `/me` ya lo refleje. */
export function useSetActingOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string | null) => platformApi.setActing(organizationId),
    onSuccess: () => {
      dropOtherQueries(qc, [platformOrganizationsKey]);
      return qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}
