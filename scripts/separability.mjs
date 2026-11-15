// Reglas de separabilidad (ADR-002 D1). Funciones puras: check-separability.mjs las aplica al disco.
import path from 'node:path';

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

const DOMAIN_PKG = /^@modivara\/([a-z]+)-(?:api|web|contracts)$/;

/**
 * ¿Puede un paquete del dominio `from` depender de `dep`? Del propio dominio, sí; de otro dominio, solo de su `*-contracts`;
 * core (infraestructura compartida, MOD-11) no depende de ningún otro dominio.
 */
function dependencyProblem(from, dep) {
  if (!dep.startsWith('@modivara/')) return null;
  const to = DOMAIN_PKG.exec(dep)?.[1];
  if (to === from) return null;
  if (from === 'core') return 'core no puede depender de otro dominio';
  return dep.endsWith('-contracts') ? null : 'un dominio solo puede depender de *-contracts';
}

/** Dependencias de package.json de los paquetes de domains/ (`name` = `@modivara/<dominio>-<api|web|contracts>`). */
export function findDependencyViolations(pkgs) {
  return pkgs.flatMap(({ name, deps }) => {
    const from = DOMAIN_PKG.exec(name)?.[1];
    return deps.flatMap((dep) => {
      const problem = dependencyProblem(from, dep);
      return problem ? [`${name} depende de ${dep}: ${problem}`] : [];
    });
  });
}

/**
 * Cada archivo pertenece a una unidad (domains/<d> o apps/<a>):
 * - nunca importa rutas internas de un paquete (`@modivara/x/...`);
 * - sus imports relativos no salen de su unidad;
 * - en domains/<d>, los imports de otros dominios cumplen la misma regla que las dependencias (aunque falte en package.json).
 */
export function findImportViolations(files) {
  return files.flatMap(({ file, unitRoot, content }) => {
    const domain = /[\\/]domains[\\/]([^\\/]+)$/.exec(unitRoot)?.[1];
    return [...content.matchAll(SPECIFIER)].flatMap(([, spec]) => {
      if (/^@modivara\/[^/]+\/.+/.test(spec)) return [`${file}: importa ruta interna ${spec}; usa solo el index del paquete`];
      const problem = domain && dependencyProblem(domain, spec);
      if (problem) return [`${file}: importa ${spec}: ${problem}`];
      if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec);
        if (target !== unitRoot && !target.startsWith(unitRoot + path.sep)) return [`${file}: ${spec} sale de ${unitRoot}`];
      }
      return [];
    });
  });
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

/**
 * MOD-11: la migración de un dominio no nombra el esquema de otro (`"hospitality".` dentro de domains/commerce): sin FK ni consultas
 * entre esquemas. `migrations` = [{ file, domain, content }]; `domains` = todos los dominios.
 */
export function findMigrationSchemaViolations(migrations, domains) {
  return migrations.flatMap(({ file, domain, content }) =>
    domains.filter((d) => d !== domain && new RegExp(`"${d}"\\s*\\.`).test(content)).map((d) => `${file}: referencia el esquema de ${d}`),
  );
}
