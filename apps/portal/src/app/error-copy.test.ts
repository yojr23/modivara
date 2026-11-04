import { expect, it } from 'vitest';
import { describeError } from './error-copy';

const http = (status: number) => Object.assign(new Error('x'), { status });

it('mapea el origen del error a copy y acción', () => {
  expect(describeError(http(500), true).text).toMatch(/servidor tuvo un problema/);
  expect(describeError(http(503), true).action).toBe('retry');
  expect(describeError(http(401), true).action).toBe('login');
  expect(describeError(http(403), true).action).toBe('none');
  expect(describeError(http(404), true).text).toMatch(/No encontramos/);
  expect(describeError(http(409), true).text).toMatch(/Otra persona/);
  expect(describeError(Object.assign(new Error('x'), { name: 'NetworkError' }), true).text).toMatch(/Sin conexión/);
  expect(describeError(new TypeError('Failed to fetch'), true).text).toMatch(/Sin conexión/);
  expect(describeError(http(500), false).text).toMatch(/Sin conexión/); // navigator.onLine manda sobre el estado
  expect(describeError(undefined, true).text).toMatch(/Algo falló/);
});
