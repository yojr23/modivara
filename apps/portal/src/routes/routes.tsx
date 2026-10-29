import type { RouteObject } from 'react-router';
import { EditorA, EditorB, EditorC, ProtoIndex } from '@/pages/proto/alternatives';
import Board from '@/pages/proto/Board';
import Editor from '@/pages/proto/Editor';
import Tokens from '@/pages/Tokens';
import { AppShell, ModuleRoute } from './AppShell';
import { Login } from './Login';
import { RequireSession } from './RequireSession';

export const routes: RouteObject[] = [
  { path: '/', element: <main className="p-6 font-display text-2xl font-bold">Modivara</main> },
  // Ruta interna de la base visual (T6); no forma parte del producto.
  { path: '/_tokens', element: <Tokens /> },
  // [DISEÑO] Prototipos para revisión (L-05, L-06), con datos locales; se borran cuando existan las pantallas reales.
  { path: '/_proto', element: <ProtoIndex /> },
  { path: '/_proto/l05-a', element: <EditorA /> },
  { path: '/_proto/l05-b', element: <EditorB /> },
  { path: '/_proto/l05-c', element: <EditorC /> },
  { path: '/_proto/editor', element: <Editor /> },
  { path: '/_proto/tablero', element: <Board /> },
  // Login por negocio (ADR-002 D2). OPEN: evoluciona a subdominio; entonces el slug sale del host.
  { path: '/:slug', element: <Login /> },
  {
    path: '/:slug/app',
    element: <RequireSession />,
    children: [{ element: <AppShell />, children: [{ index: true, element: null }, { path: ':module', element: <ModuleRoute /> }] }],
  },
];
