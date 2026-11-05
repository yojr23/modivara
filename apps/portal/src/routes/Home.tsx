import { slugSchema } from '@modivara/core-contracts';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Wordmark } from '@/app/ui';
import { Button } from '@/ui/Button';

// Portada (`/`): el login es por negocio (`/<slug>`, ADR-002 D2), así que se pregunta el negocio y se lleva a su login.
// Validación = `slugSchema` de core-contracts (la misma regla que usa el login); si el negocio no existe, el login lo dirá.
export function Home() {
  const navigate = useNavigate();
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = slugSchema.safeParse(new FormData(e.currentTarget).get('slug'));
    if (!parsed.success) return setInvalid(true);
    navigate(`/${parsed.data}`);
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 text-fg">
      <form onSubmit={submit} noValidate className="anim-rise w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-8 shadow-sm">
        <Wordmark />
        <h1 className="text-2xl font-bold">¿Cuál es tu negocio?</h1>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Identificador de tu negocio</span>
          <input
            name="slug" autoCapitalize="none" autoCorrect="off" spellCheck={false} required aria-invalid={invalid} aria-describedby={invalid ? 'slug-err' : undefined}
            onChange={() => setInvalid(false)} className="h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-base"
          />
          <span className="mt-1 block text-xs text-muted">Va en la dirección de tu login y te lo da quien administra tu negocio; por ejemplo bar-demo.</span>
        </label>
        {invalid && <p id="slug-err" role="alert" className="rounded-md border border-danger/40 bg-danger/6 px-3 py-2 text-sm">Usa de 3 a 40 letras minúsculas, números y guiones (sin espacios ni guion al inicio o al final).</p>}
        <Button type="submit" size="lg" className="w-full">Continuar</Button>
      </form>
    </main>
  );
}
