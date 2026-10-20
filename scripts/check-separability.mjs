// Prueba de separabilidad (ADR-002 D1): falla si un dominio no podría vivir en su propio repositorio.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findDependencyViolations, findImportViolations } from './separability.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;

// Solo código fuente (src/): la configuración de herramientas del workspace se reemplaza al separar repositorios.
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && SOURCE.test(e.name))
    .map((e) => path.join(e.parentPath, e.name))
    .filter((f) => /[\\/]src[\\/]/.test(path.relative(dir, f)) && !/[\\/]node_modules[\\/]/.test(f));
}

const domains = dirs(path.join(root, 'domains'));
const units = [
  ...domains.map((d) => path.join(root, 'domains', d)),
  ...dirs(path.join(root, 'apps')).map((a) => path.join(root, 'apps', a)),
];

const pkgs = domains.flatMap((d) =>
  dirs(path.join(root, 'domains', d)).map((kind) => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'domains', d, kind, 'package.json'), 'utf8'));
    return { name: pkg.name, deps: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }) };
  }),
);
const files = units.flatMap((unitRoot) =>
  sourceFiles(unitRoot).map((file) => ({ file, unitRoot, content: readFileSync(file, 'utf8') })),
);

const violations = [...findDependencyViolations(pkgs), ...findImportViolations(files)].map((v) => v.replaceAll(root + path.sep, ''));
if (violations.length) {
  console.error(`Separabilidad: ${violations.length} violación(es)\n- ${violations.join('\n- ')}`);
  process.exit(1);
}
console.log(`Separabilidad estática OK (${pkgs.length} paquetes, ${files.length} archivos).`);

// Cada dominio compila y pasa sus pruebas solo, con sus dependencias declaradas (solo contracts ajenos).
for (const d of domains) {
  const run = (filter, script) => execSync(`pnpm --filter "${filter}" --if-present run ${script}`, { cwd: root, stdio: 'inherit' });
  console.log(`\n▶ dominio ${d}`);
  run(`{./domains/${d}/**}...`, 'build');
  run(`./domains/${d}/**`, 'typecheck');
  run(`./domains/${d}/**`, 'test');
}
console.log('\nSeparabilidad OK: cada dominio compila y pasa sus pruebas de forma aislada.');
