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
