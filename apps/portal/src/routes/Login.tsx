import { ApiRequestError, loginRequestSchema, useLogin, useSession } from '@modivara/core-web';
import { useState, type FormEvent } from 'react';
import { Navigate, useParams } from 'react-router';
import { Wordmark } from '@/app/ui';
import { Button } from '@/ui/Button';

// Login por negocio (`/<slug>`, ADR-002 D2), con el lenguaje del portal. El mismo mensaje para usuario inexistente,
// clave errada o cuenta bloqueada (no se revela cuál; TECH-001 §16.3).
const MESSAGES: Record<string, string> = {
  invalid_input: 'Escribe tu usuario y tu contraseña.',
  unauthorized: 'Usuario o contraseña incorrectos.',
  invalid_credentials: 'Usuario o contraseña incorrectos.',
  rate_limited: 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
};
const input = 'h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-base';

export function Login() {
  const { slug = '' } = useParams();
  const session = useSession();
  const login = useLogin();
  const [error, setError] = useState<string | null>(null);

  // Con sesión de este mismo negocio, directo a la app; con sesión de otro, se muestra el login para entrar a este.
  if (session.status === 'authenticated' && session.me.organization?.slug === slug) return <Navigate to={`/${slug}/app`} replace />;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = loginRequestSchema.safeParse({ slug, username: f.get('username'), password: f.get('password') });
    if (!parsed.success) return setError('invalid_input');
    setError(null);
    login.mutate(parsed.data, {
      onError: (err) => setError(err instanceof ApiRequestError ? (err.status === 429 ? 'rate_limited' : err.status === 401 ? 'unauthorized' : err.code) : 'network'),
    });
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 text-fg">
      <form onSubmit={submit} noValidate className="anim-rise w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-8 shadow-sm">
        <Wordmark />
        <div>
          <h1 className="text-2xl font-bold">Entrar</h1>
          <p className="text-sm text-muted">Negocio <span className="font-semibold text-fg">{slug}</span></p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Usuario</span>
          <input name="username" autoComplete="username" autoCapitalize="none" required className={input} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Contraseña</span>
          <input name="password" type="password" autoComplete="current-password" required className={input} />
        </label>
        {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/6 px-3 py-2 text-sm">{MESSAGES[error] ?? 'No se pudo entrar. Revisa tu conexión y vuelve a intentar.'}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>{login.isPending ? 'Entrando…' : 'Entrar'}</Button>
      </form>
    </main>
  );
}
