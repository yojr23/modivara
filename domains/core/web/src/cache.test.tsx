import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiRequestError } from './client.js';
import { AuthProvider, useLogin, useLogout, useSession } from './session.js';
import { json, makeMe } from './testing/fixtures.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(fetchImpl: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => fetchImpl(url)));
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><AuthProvider>{children}</AuthProvider></QueryClientProvider>
  );
  return { qc, wrapper };
}
const SECRET = ['hospitality', 'calls'];

it('logout borra los datos cacheados del usuario', async () => {
  const { qc, wrapper } = setup((u) => (u.endsWith('/auth/logout') ? new Response(null, { status: 204 }) : json(makeMe())));
  const { result } = renderHook(() => ({ s: useSession(), out: useLogout() }), { wrapper });
  await waitFor(() => expect(result.current.s.status).toBe('authenticated'));
  qc.setQueryData(SECRET, ['mesa 5']);
  await act(() => result.current.out.mutateAsync());
  expect(qc.getQueryData(SECRET)).toBeUndefined();
  await waitFor(() => expect(result.current.s.status).toBe('anonymous'));
});

it('un 401 de cualquier consulta borra los datos cacheados', async () => {
  const { qc, wrapper } = setup(() => json(makeMe()));
  const { result } = renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('authenticated'));
  qc.setQueryData(SECRET, ['mesa 5']);
  await qc.fetchQuery({ queryKey: ['x'], queryFn: () => { throw new ApiRequestError(401, 'session_expired'); }, retry: false }).catch(() => {});
  expect(qc.getQueryData(SECRET)).toBeUndefined();
  await waitFor(() => expect(result.current.status).toBe('anonymous'));
});

it('/me con 401 borra los datos cacheados', async () => {
  const { qc, wrapper } = setup(() => json({ code: 'unauthorized' }, 401));
  qc.setQueryData(SECRET, ['mesa 5']);
  render(<QueryClientProvider client={qc}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  await screen.findByText('anonymous');
  expect(qc.getQueryData(SECRET)).toBeUndefined();
  void wrapper;
});
function Probe() { return <p>{useSession().status}</p>; }

it('un login borra los datos que dejó otro usuario', async () => {
  const { qc, wrapper } = setup((u) => (u.endsWith('/auth/login') ? json({ actor: makeMe().actor, expires_at: '2030-01-01T00:00:00Z' }) : json({ code: 'unauthorized' }, 401)));
  const { result } = renderHook(() => ({ s: useSession(), login: useLogin() }), { wrapper });
  await waitFor(() => expect(result.current.s.status).toBe('anonymous'));
  qc.setQueryData(SECRET, ['datos de otro usuario']);
  await act(() => result.current.login.mutateAsync({ slug: 'demo', username: 'ana', password: 'x' }));
  expect(qc.getQueryData(SECRET)).toBeUndefined();
});

it('una respuesta en vuelo del usuario anterior no repuebla el caché tras logout', async () => {
  const { qc, wrapper } = setup((u) => (u.endsWith('/auth/logout') ? new Response(null, { status: 204 }) : json(makeMe())));
  const { result } = renderHook(() => ({ s: useSession(), out: useLogout() }), { wrapper });
  await waitFor(() => expect(result.current.s.status).toBe('authenticated'));
  let release!: (v: string[]) => void;
  const inFlight = qc.fetchQuery({ queryKey: SECRET, queryFn: () => new Promise<string[]>((r) => (release = r)) }).catch(() => undefined);
  await act(() => result.current.out.mutateAsync());
  release(['mesa 5']);
  await inFlight;
  expect(qc.getQueryData(SECRET)).toBeUndefined();
});
