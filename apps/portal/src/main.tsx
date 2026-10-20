import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import './index.css';
import Tokens from './pages/Tokens';

const router = createBrowserRouter([
  { path: '/', element: <main className="p-6 font-display text-2xl font-bold">Modivara</main> },
  // Ruta interna de la base visual (T6); no forma parte del producto.
  { path: '/_tokens', element: <Tokens /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
