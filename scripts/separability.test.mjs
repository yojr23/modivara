import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDependencyViolations, findImportViolations } from './separability.mjs';

const unitRoot = path.resolve('/repo/domains/hospitality');
const file = path.join(unitRoot, 'api/src/application/x.ts');
const check = (content) => findImportViolations([{ file, unitRoot, content }]);

describe('findDependencyViolations', () => {
  it('permite depender de contracts de otros dominios', () => {
    expect(findDependencyViolations([{ name: '@modivara/hospitality-api', deps: ['@modivara/core-contracts', 'zod'] }])).toEqual([]);
  });

  it('rechaza depender de la api o la web de otro dominio', () => {
    const v = findDependencyViolations([{ name: '@modivara/hospitality-api', deps: ['@modivara/core-api', '@modivara/commerce-web'] }]);
    expect(v).toHaveLength(2);
  });
});

describe('findImportViolations', () => {
  it('acepta el index público y rutas relativas internas', () => {
    expect(check(`import { a } from '@modivara/core-contracts';\nimport { b } from '../domain/b.js';`)).toEqual([]);
  });

  it('rechaza rutas internas de otro paquete', () => {
    expect(check(`import { a } from '@modivara/core-api/src/domain/user.js';`)).toHaveLength(1);
    expect(check(`const m = await import('@modivara/core-contracts/dist/index.js');`)).toHaveLength(1);
  });

  it('rechaza rutas relativas que salen del dominio', () => {
    expect(check(`import { u } from '../../../../core/api/src/domain/user.js';`)).toHaveLength(1);
    expect(check(`export * from '../../../../commerce/contracts/src/index.js';`)).toHaveLength(1);
  });
});
