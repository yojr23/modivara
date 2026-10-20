import { useSession } from '@modivara/core-web';
import { Navigate, Outlet, useParams } from 'react-router';

// OPEN: ¿qué pasa si el slug de la URL no coincide con me.organization.slug? (ADR-002 D2 no lo define; hoy no se valida.)
export function RequireSession() {
  const { slug } = useParams();
  const session = useSession();
  if (session.status === 'loading') return <p role="status">Cargando…</p>; // [DISEÑO] provisional
  if (session.status === 'anonymous') return <Navigate to={`/${slug}`} replace />;
  return <Outlet />;
}
