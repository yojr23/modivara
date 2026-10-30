import { useSession } from '@modivara/core-web';
import { Navigate, Outlet, useParams } from 'react-router';

export function RequireSession() {
  const { slug } = useParams();
  const session = useSession();
  if (session.status === 'loading') return <p role="status">Cargando…</p>; // [DISEÑO] provisional
  if (session.status === 'anonymous') return <Navigate to={`/${slug}`} replace />;
  return <Outlet />;
}
