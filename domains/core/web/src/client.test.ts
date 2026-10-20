import { afterEach, expect, it, vi } from 'vitest';
import { ApiRequestError, InvalidResponseError, coreApi } from './client.js';
import { json, makeMe } from './testing/fixtures.js';

afterEach(() => vi.unstubAllGlobals());
const stub = (res: Response) => { const f = vi.fn().mockResolvedValue(res); vi.stubGlobal('fetch', f); return f; };

it('GET /me valida contra el contrato y envía credenciales', async () => {
  const f = stub(json(makeMe()));
  expect((await coreApi.me()).modules).toEqual(['hospitality']);
  expect(f).toHaveBeenCalledWith('/api/v1/me', expect.objectContaining({ credentials: 'include' }));
});

it('respuesta fuera de contrato lanza InvalidResponseError', async () => {
  stub(json({ actor: 1 }));
  await expect(coreApi.me()).rejects.toBeInstanceOf(InvalidResponseError);
});

it('error de la API expone code y status', async () => {
  stub(json({ code: 'invalid_credentials' }, 401));
  await expect(coreApi.me()).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 });
});

it('error sin cuerpo válido da unknown_error', async () => {
  stub(new Response('<html>', { status: 502 }));
  const e = await coreApi.me().catch((x) => x);
  expect(e).toBeInstanceOf(ApiRequestError);
  expect(e.code).toBe('unknown_error');
});

it('logout acepta respuesta vacía', async () => {
  stub(new Response(null, { status: 204 }));
  await expect(coreApi.logout()).resolves.toBeUndefined();
});
