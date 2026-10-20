import type { RouteObject } from 'react-router';
import Tokens from '@/pages/Tokens';
import { AppShell, ModuleRoute } from './AppShell';
import { Login } from './Login';
import { RequireSession } from './RequireSession';

export const routes: RouteObject[] = [
  { path: '/', element: <main className="p-6 font-display text-2xl font-bold">Modivara</main> },
  // Ruta interna de la base visual (T6); no forma parte del producto.
  { path: '/_tokens', element: <Tokens /> },
  // Login por negocio (ADR-002 D2). OPEN: evoluciona a subdominio; entonces el slug sale del host.
  { path: '/:slug', element: <Login /> },
  {
    path: '/:slug/app',
    element: <RequireSession />,
    children: [{ element: <AppShell />, children: [{ index: true, element: null }, { path: ':module', element: <ModuleRoute /> }] }],
  },
];
