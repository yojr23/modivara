import { useQuery } from '@tanstack/react-query';
import { platformApi } from './client.js';

export const platformOrganizationsKey = ['core', 'platform', 'organizations'] as const;

/** Negocios con sus locales para la consola de superadmin. */
export const usePlatformOrganizations = () => useQuery({ queryKey: platformOrganizationsKey, queryFn: platformApi.organizations, retry: false });
