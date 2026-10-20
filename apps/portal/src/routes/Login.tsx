
import { ApiRequestError, loginRequestSchema, useLogin, useSession } from '@modivara/core-web';
import { useState, type FormEvent } from 'react';
import { Navigate, useParams } from 'react-router';
import { Button } from '@/ui/Button';

// [DISEÑO] provisional: andamio funcional sin diseño; la pantalla final es F1-14.
export function Login() {
  const { slug = '' } = useParams();
  const session = useSession();
  const login = useLogin();
  const [error, setError] = useState<string | null>(null);

  if (session.status === 'authenticated') return <Navigate to={`/${slug}/app`} replace />;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = loginRequestSchema.safeParse({ slug, username: f.get('username'), password: f.get('password') });
    if (!parsed.success) return setError('invalid_input');
    setError(null);
    login.mutate(parsed.data, { onError: (err) => setError(err instanceof ApiRequestError ? err.code : 'unknown_error') });
  };

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3 p-6">
      <label>Usuario <input name="username" autoComplete="username" className="border" /></label>
      <label>Contraseña <input name="password" type="password" autoComplete="current-password" className="border" /></label>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={login.isPending}>Entrar</Button>
    </form>
  );
}
