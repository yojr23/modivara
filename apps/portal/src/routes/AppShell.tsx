import type { ModuleName } from '@modivara/core-contracts';
import { useLogout, useSession } from '@modivara/core-web';
import { RealtimeProvider } from '@modivara/hospitality-web';
import { ChartColumn, ConciergeBell, Map as MapIcon, Package, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Navigate, Outlet, useParams } from 'react-router';
import Board from '@/app/Board';
import Inventory from '@/app/Inventory';
import Metrics from '@/app/Metrics';
import Spaces from '@/app/Spaces';
import { AppContext, EmptyState, Wordmark, type Permission, useApp } from '@/app/ui';

/**
 * Pantallas del portal: cada una exige su módulo contratado y alguno de sus permisos en el local activo (la UI solo oculta;
 * la autorización la decide el backend). OPEN: al separar repos (ADR-002 D1), ¿las pantallas viven en cada `domains/<d>/web`
 * con un kit visual compartido? Hoy están en el portal porque el kit (botones, shell, gráficos) vive aquí.
 */
const SCREENS: { id: string; label: string; Icon: LucideIcon; module: ModuleName; perms: Permission[]; element: ReactNode }[] = [
  { id: 'tablero', label: 'Tablero', Icon: ConciergeBell, module: 'hospitality', perms: ['hospitality.calls.read'], element: <Board /> },
  { id: 'espacios', label: 'Espacios', Icon: MapIcon, module: 'hospitality', perms: ['hospitality.tables.manage'], element: <Spaces /> },
  { id: 'metricas', label: 'Métricas', Icon: ChartColumn, module: 'analytics', perms: ['analytics.calls.read', 'analytics.inventory.read'], element: <Metrics /> },
  { id: 'inventario', label: 'Inventario', Icon: Package, module: 'commerce', perms: ['commerce.stock.read'], element: <Inventory /> },
];

/** Sesión → local activo → pantallas permitidas. El tiempo real se abre por local si el negocio tiene hospitality. */
export function AppShell() {
  const { slug } = useParams();
  const { me } = useSession();
  const logout = useLogout();
  const [locationId, setLocationId] = useState<string | null>(null);
  if (!me) return null; // RequireSession ya garantiza sesión
  const location = me.locations.find((l) => l.id === locationId) ?? me.locations[0];
  if (!location) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <EmptyState title="Sin locales asignados" text="Tu usuario todavía no tiene acceso a ningún local. Pide a quien administra el negocio que te asigne uno." action={<button type="button" className="text-link underline" onClick={() => logout.mutate()}>Salir</button>} />
      </main>
    );
  }
  const can = (p: Permission) => location.permissions.includes(p);
  const nav = SCREENS.filter((s) => me.modules.includes(s.module) && s.perms.some(can)).map(({ id, label, Icon }) => ({ id, label, Icon, to: `/${slug}/app/${id}` }));
  const value = { me, location, setLocationId, can, nav, logout: () => logout.mutate() };
  return (
    <AppContext value={value}>
      {me.modules.includes('hospitality') ? <RealtimeProvider locationId={location.id}><Outlet /></RealtimeProvider> : <Outlet />}
    </AppContext>
  );
}

/** `/:slug/app`: abre la primera pantalla permitida. */
export function AppHome() {
  const { nav } = useApp();
  if (nav[0]) return <Navigate to={nav[0].to} replace />;
  return (
    <main className="grid min-h-dvh place-items-center bg-bg">
      <div className="text-center"><Wordmark /><EmptyState title="Nada que mostrar todavía" text="Tu rol en este local no incluye ninguna pantalla del portal." /></div>
    </main>
  );
}

/** Pantalla por URL: si no está permitida (módulo o permiso), vuelve al inicio. */
export function ScreenRoute() {
  const { slug, screen } = useParams();
  const { nav } = useApp();
  const found = SCREENS.find((s) => s.id === screen);
  if (!found || !nav.some((n) => n.id === found.id)) return <Navigate to={`/${slug}/app`} replace />;
  return found.element;
}
