import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateUserRequest, ResetPasswordRequest, SetLocationRolesRequest } from '@modivara/core-contracts';
import { usersApi } from './client.js';

export const usersKey = ['core', 'users'] as const;

/** Mutación que invalida la lista de usuarios (activo/roles cambian lo que se muestra). */
function usersMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }) });
}

export const useUsers = () => useQuery({ queryKey: usersKey, queryFn: usersApi.list, retry: false });
export const useCreateUser = () => usersMutation((v: CreateUserRequest) => usersApi.create(v));
export const useResetPassword = () =>
  usersMutation((v: { userId: string; input: ResetPasswordRequest }) => usersApi.resetPassword(v.userId, v.input));
export const useDeactivateUser = () => usersMutation((userId: string) => usersApi.deactivate(userId));
export const useRevokeUserSessions = () => usersMutation((userId: string) => usersApi.revokeSessions(userId));
export const useSetLocationRoles = () =>
  usersMutation((v: { userId: string; locationId: string; input: SetLocationRolesRequest }) =>
    usersApi.setLocationRoles(v.userId, v.locationId, v.input));
