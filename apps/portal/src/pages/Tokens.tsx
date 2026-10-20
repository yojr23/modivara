import { Clock, Wifi } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { StatusBadge, type CallStatus } from '../ui/StatusBadge';

const BRAND = [
  ['Azul tinta', '#101E33', 'Identidad, fondos oscuros, títulos', 'bg-ink'],
  ['Verde conexión', '#1BAA95', 'Acciones principales y conexión', 'bg-connect'],
  ['Azul interfaz', '#3865E9', 'Enlaces, foco, plataforma', 'bg-interface'],
  ['Blanco cálido', '#F7FAFC', 'Paneles y páginas claras', 'bg-warm'],
  ['Grafito', '#182338', 'Texto principal sobre claro', 'bg-graphite'],
  ['Ámbar operacional', '#E6A03D', 'Atención que requiere revisión', 'bg-amber'],
] as const;

const TABLES: { mesa: number; status: CallStatus; tiempo: string; texto: string }[] = [
  { mesa: 5, status: 'pending', tiempo: '2 min 14 s', texto: 'Mesa 5 necesita atención' },
  { mesa: 12, status: 'attending', tiempo: '0 min 48 s', texto: 'Mesa 12 en atención' },
  { mesa: 3, status: 'done', tiempo: '1 min 05 s', texto: 'Mesa 3 atendida' },
];

function TableCard({ mesa, status, tiempo, texto }: (typeof TABLES)[number]) {
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-surface p-4',
        status === 'pending' ? 'call-pending border-pending border-2' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-4xl font-bold tabular-nums">{mesa}</span>
        <StatusBadge status={status} />
      </div>
      <p className={cn('text-base', status === 'pending' ? 'font-semibold' : 'text-muted')}>{texto}</p>
      <p className="flex items-center gap-1.5 text-sm tabular-nums text-muted">
        <Clock aria-hidden className="size-4" />
        {tiempo}
      </p>
      {status !== 'done' && (
        <Button size="lg" variant={status === 'pending' ? 'primary' : 'secondary'}>
          {status === 'pending' ? 'Marcar en atención' : 'Finalizar'}
        </Button>
      )}
    </article>
  );
}

function Themed({ theme, title }: { theme?: 'dark'; title: string }) {
  return (
    <section data-theme={theme} className="rounded-2xl border border-line bg-bg p-6 text-fg">
      <h2 className="mb-5 flex items-center justify-between text-xl font-bold">
        {title}
        <span className="flex items-center gap-1.5 text-sm font-medium text-muted">
          <Wifi aria-hidden className="size-4" /> Conectado
        </span>
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button>Principal</Button>
        <Button variant="secondary">Secundario</Button>
        <Button variant="ghost">Fantasma</Button>
        <Button disabled>Deshabilitado</Button>
        <Button size="sm">Pequeño</Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(['pending', 'attending', 'done'] as const).map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </div>
      <p className="mt-4 text-sm">
        Texto atenuado y <a className="text-link underline" href="#tokens">enlace de ejemplo</a>.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {TABLES.map((t) => (
          <TableCard key={t.mesa} {...t} />
        ))}
      </div>
    </section>
  );
}

export default function Tokens() {
  return (
    <main id="tokens" className="mx-auto max-w-5xl space-y-10 p-6">
      <header>
        <p className="text-sm font-medium text-muted">Interno · no es una pantalla del producto</p>
        <h1 className="text-3xl font-bold">Base visual de Modivara</h1>
      </header>

      <section>
        <h2 className="mb-4 text-xl font-bold">Colores de marca</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BRAND.map(([name, hex, use, bg]) => (
            <li key={hex} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className={cn('h-16', bg)} />
              <div className="p-3">
                <p className="font-semibold">{name}</p>
                <p className="text-sm tabular-nums text-muted">{hex}</p>
                <p className="text-sm text-muted">{use}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">Tipografía</h2>
        <div className="space-y-2 rounded-xl border border-line bg-surface p-5">
          <p className="font-display text-4xl font-bold">Manrope · títulos</p>
          <p className="text-base">Inter · interfaz. Cada llamado visible, más control sobre la atención.</p>
          <p className="text-base tabular-nums">Cifras tabulares: 0123456789 · 12:48:05 · 2 min 14 s</p>
        </div>
      </section>

      <Themed title="Tema claro · administración" />
      <Themed theme="dark" title="Tema oscuro · tablero de barra" />
    </main>
  );
}
