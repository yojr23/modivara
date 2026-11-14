import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDependencyViolations, findImportViolations, findLayerViolations } from './separability.mjs';

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

  it('MOD-11: core no depende de ningún otro dominio, ni de sus contracts (regresión core-api → hospitality-contracts)', () => {
    const pkg = { name: '@modivara/core-api', dependencies: { '@modivara/core-contracts': 'workspace:*', '@modivara/hospitality-contracts': 'workspace:*' } };
    const v = findDependencyViolations([{ name: pkg.name, deps: Object.keys(pkg.dependencies) }]);
    expect(v).toEqual(['@modivara/core-api depende de @modivara/hospitality-contracts: core no puede depender de otro dominio']);
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

  it('un dominio solo importa contracts ajenos; core no importa ningún dominio (aunque no esté en package.json)', () => {
    expect(check(`import { a } from '@modivara/commerce-contracts';\nimport { b } from '@modivara/commerce-api';\nimport { c } from '@modivara/hospitality-api';`)).toHaveLength(1);
    const coreRoot = path.resolve('/repo/domains/core');
    const core = (content) => findImportViolations([{ file: path.join(coreRoot, 'api/src/presentation/x.ts'), unitRoot: coreRoot, content }]);
    expect(core(`import { platformActionRecordedEventSchema } from '@modivara/hospitality-contracts';`)).toHaveLength(1);
    expect(core(`import { a } from '@modivara/core-contracts';`)).toEqual([]);
  });
});

describe('findLayerViolations', () => {
  const layer = (rel, content) => findLayerViolations([{ file: path.join('/repo', rel), content }]);
  it('domain no importa frameworks ni capas externas', () => {
    expect(layer('domains/core/api/src/domain/u.ts', `import { z } from 'zod';\nimport { A } from '../infrastructure/a.js';\nimport { Injectable } from '@nestjs/common';`)).toHaveLength(3);
    expect(layer('domains/core/api/src/domain/u.ts', `import { b } from './b.js';\nimport { c } from '@modivara/core-contracts';`)).toEqual([]);
  });
  it('application no importa Prisma ni infrastructure, pero sí Nest/zod', () => {
    expect(layer('domains/core/api/src/application/u.ts', `import { P } from '@prisma/client';\nimport { A } from '../infrastructure/a.js';`)).toHaveLength(2);
    expect(layer('domains/core/api/src/application/u.ts', `import { Injectable } from '@nestjs/common';`)).toEqual([]);
  });
  it('apps/api no importa domain/ ni application/', () => {
    expect(layer('apps/api/src/x.ts', `import { U } from '@modivara/core-api/domain/user.js';`)).toHaveLength(1);
    expect(layer('apps/api/src/x.ts', `import { CoreModule } from '@modivara/core-api';`)).toEqual([]);
  });
});
