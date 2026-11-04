// Reglas de separabilidad (ADR-002 D1). Funciones puras: check-separability.mjs las aplica al disco.
import path from 'node:path';

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

/** Un paquete de domains/ solo puede depender de `@modivara/*-contracts`. */
export function findDependencyViolations(pkgs) {
  return pkgs.flatMap(({ name, deps }) =>
    deps
      .filter((dep) => dep.startsWith('@modivara/') && !dep.endsWith('-contracts'))
      .map((dep) => `${name} depende de ${dep}: un dominio solo puede depender de *-contracts`),
  );
}

/**
 * Cada archivo pertenece a una unidad (domains/<d> o apps/<a>):
 * - nunca importa rutas internas de un paquete (`@modivara/x/...`);
 * - sus imports relativos no salen de su unidad.
 */
export function findImportViolations(files) {
  return files.flatMap(({ file, unitRoot, content }) =>
    [...content.matchAll(SPECIFIER)].flatMap(([, spec]) => {
      if (/^@modivara\/[^/]+\/.+/.test(spec)) return [`${file}: importa ruta interna ${spec}; usa solo el index del paquete`];
      if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec);
        if (target !== unitRoot && !target.startsWith(unitRoot + path.sep)) return [`${file}: ${spec} sale de ${unitRoot}`];
      }
      return [];
    }),
  );
}

const FRAMEWORK = /^(@nestjs\/|@prisma\/|zod$|react($|\/)|react-dom)/;
const OUTER_LAYER = /(^|\/)(infrastructure|presentation)(\/|$)/;

/**
 * Capas de Clean Architecture (QA-07, TECH-001 §5). `file` en cualquier separador:
 * - domains/<d>/api/src/domain/**: sin Nest, Prisma, Zod ni React, ni imports de infrastructure/presentation;
 * - domains/<d>/api/src/application/**: sin Prisma ni infrastructure;
 * - se ignoran los *.test.* (cablean adaptadores a propósito);
 * - apps/api/src: solo compone módulos, no importa carpetas domain/ ni application/.
 */
export function findLayerViolations(files) {
  return files.flatMap(({ file, content }) => {
    const f = file.replaceAll('\\', '/');
    if (/\.test\.[mc]?[jt]sx?$/.test(f)) return []; // las pruebas de integración cablean adaptadores a propósito
    const inLayer = (layer) => new RegExp(`domains/[^/]+/api/src/${layer}/`).test(f);
    const isDomain = inLayer('domain');
    const isApplication = inLayer('application');
    const isHost = /(^|\/)apps\/api\/src\//.test(f);
    if (!isDomain && !isApplication && !isHost) return [];
    return [...content.matchAll(SPECIFIER)].flatMap(([, spec]) => {
      if (isDomain && (FRAMEWORK.test(spec) || OUTER_LAYER.test(spec))) return [`${file}: domain no puede importar ${spec}`];
      if (isApplication && (/^@prisma\//.test(spec) || /(^|\/)infrastructure(\/|$)/.test(spec))) return [`${file}: application no puede importar ${spec}`];
      if (isHost && /(^|\/)(domain|application)\//.test(spec)) return [`${file}: apps/api no implementa negocio; importa ${spec}`];
      return [];
    });
  });
}
