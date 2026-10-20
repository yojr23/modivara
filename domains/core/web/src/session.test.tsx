import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiRequestError } from './client.js';
import { visibleModules } from './navigation.js';
import { AuthProvider, useSession } from './session.js';
import { json, makeMe } from './testing/fixtures.js';

afterEach(() => vi.unstubAllGlobals());

function Probe() {
  const s = useSession();
  useQuery({ queryKey: ['other'], queryFn: () => { throw new ApiRequestError(401, 'unauthorized'); }, retry: false, enabled: s.status === 'authenticated' });
  return <p>{s.status}</p>;
}
const mount = () => render(
  <QueryClientProvider client={new QueryClient()}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>,
);

it('con sesión válida queda authenticated hasta que otra consulta da 401; entonces limpia', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(makeMe())));
  mount();
  await screen.findByText('authenticated');
  await waitFor(() => expect(screen.getByText('anonymous')).toBeTruthy());
});

it('/me 401 es anonymous', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'unauthorized' }, 401)));
  mount();
  await screen.findByText('anonymous');
});

it('navegación: solo los módulos del negocio', () => {
  expect(visibleModules(makeMe({ modules: ['analytics'] }))).toEqual(['analytics']);
});
