import { MODULES, isModuleEnabled, useLogout, useSession, visibleLocations, visibleModules } from '@modivara/core-web';

import { Link, Navigate, Outlet, useParams } from 'react-router';
import { Button } from '@/ui/Button';

// [DISEÑO] provisional: la navegación solo expone módulos y locales de `me`; el layout final es F1-15.
export function AppShell() {
  const { slug } = useParams();
  const { me } = useSession();
  const logout = useLogout();
  if (!me) return null; // RequireSession ya garantiza sesión
  return (
    <div>
      <nav aria-label="Módulos">
        {visibleModules(me).map((m) => <Link key={m} to={`/${slug}/app/${m}`}>{m}</Link>)}
      </nav>
      <ul aria-label="Locales">
        {visibleLocations(me).map((l) => <li key={l.id}>{l.name}</li>)}
      </ul>
      <Button variant="ghost" onClick={() => logout.mutate()}>Salir</Button>
      <Outlet />
    </div>
  );
}

/** Ruta de un módulo: si el negocio no lo tiene contratado, vuelve al inicio (el backend igual lo rechazaría). */
export function ModuleRoute() {
  const { slug, module } = useParams();
  const { me } = useSession();
  const known = MODULES.find((m) => m === module);
  if (!me || !known || !isModuleEnabled(me, known)) return <Navigate to={`/${slug}/app`} replace />;
  return <p>{known}</p>; // [DISEÑO] provisional: las pantallas del módulo llegan con sus fases
}
