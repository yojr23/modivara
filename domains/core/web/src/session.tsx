import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { LoginRequest, MeResponse } from '@modivara/core-contracts';
import { ApiRequestError, coreApi } from './client.js';

const ME_KEY = ['core', 'me'] as const;

export type Session =
  | { status: 'loading'; me: null }
  | { status: 'anonymous'; me: null }
  | { status: 'authenticated'; me: MeResponse };

const SessionContext = createContext<Session | null>(null);

const isUnauthorized = (e: unknown) => e instanceof ApiRequestError && e.status === 401;

/** `GET /me`; un 401 significa "sin sesión" (null), no un error. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await coreApi.me();
      } catch (e) {
        if (isUnauthorized(e)) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

/** Provee la sesión y limpia todo (caché incluida) ante un 401 de cualquier consulta o mutación. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isPending } = useMe();

  useEffect(() => {
    const clear = () => {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[1] !== 'me' });
    };
    const offQueries = qc.getQueryCache().subscribe((ev) => {
      if (ev.type === 'updated' && ev.action.type === 'error' && isUnauthorized(ev.action.error)) clear();
    });
    const offMutations = qc.getMutationCache().subscribe((ev) => {
      if (ev.type === 'updated' && ev.action.type === 'error' && isUnauthorized(ev.action.error) && ev.mutation.options.mutationKey?.[0] !== 'core-login') clear();
    });
    return () => { offQueries(); offMutations(); };
  }, [qc]);

  const session: Session = isPending ? { status: 'loading', me: null } : data ? { status: 'authenticated', me: data } : { status: 'anonymous', me: null };
  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession requiere <AuthProvider>');
  return s;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['core-login'], // un 401 aquí es "credenciales inválidas", no sesión caducada
    mutationFn: (input: LoginRequest) => coreApi.login(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => coreApi.logout(),
    // Aunque falle la red, el portal descarta su sesión local.
    onSettled: () => { qc.setQueryData(ME_KEY, null); qc.removeQueries({ predicate: (q) => q.queryKey[1] !== 'me' }); },
  });
}

