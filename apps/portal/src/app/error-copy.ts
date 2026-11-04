// Copy de los errores de carga según su origen. Los clientes `domains/*/web` exponen `status` (ApiRequestError) y `NetworkError`;
// se leen por forma y no por clase porque cada dominio define la suya.
export type ErrorAction = 'retry' | 'login' | 'none';
export type ErrorCopy = { text: string; action: ErrorAction };

export function describeError(error: unknown, online: boolean = typeof navigator === 'undefined' || navigator.onLine): ErrorCopy {
  const e = error as { status?: unknown; name?: unknown } | null | undefined;
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (!online || e?.name === 'NetworkError' || error instanceof TypeError) {
    return { text: 'Sin conexión con el servidor. Revisa tu internet; lo que ya estaba guardado no se perdió.', action: 'retry' };
  }
  if (status === 401) return { text: 'Tu sesión terminó. Vuelve a entrar para continuar.', action: 'login' };
  if (status === 403) return { text: 'No tienes permiso para ver esto. Pide acceso a quien administra el negocio.', action: 'none' };
  if (status === 404) return { text: 'No encontramos lo que buscas; puede que ya no exista.', action: 'retry' };
  if (status === 409) return { text: 'Otra persona cambió esto mientras tanto. Vuelve a cargar para ver lo más reciente.', action: 'retry' };
  if (status !== undefined && status >= 500) return { text: 'El servidor tuvo un problema. Lo que ya estaba guardado no se perdió; prueba de nuevo en un momento.', action: 'retry' };
  return { text: 'Algo falló al cargar. Lo que ya estaba guardado no se perdió.', action: 'retry' };
}
