import { ChartColumn, ConciergeBell, Map as MapIcon, Package, RotateCw, WifiOff, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';

// [DISEÑO] Piezas comunes de los prototipos de L-06, F5-12 y F4-09 (PLAN-002): mismo shell que el editor de espacios (L-05).

// ponytail: copia del Wordmark de Editor.tsx (no exportado; ese archivo es del editor y no se toca). Unificar al pasar a pantallas reales.
export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg aria-hidden viewBox="0 0 26 10" className="h-2.5 w-7">
        <rect width="8" height="10" rx="2" className="fill-connect" />
        <rect x="9" width="8" height="10" rx="2" className="fill-interface" />
        <rect x="18" width="8" height="10" rx="2" className={dark ? 'fill-warm' : 'fill-ink'} />
      </svg>
      <span className="font-display text-lg font-extrabold tracking-tight">Modivara</span>
    </span>
  );
}

export type Module = 'tablero' | 'espacios' | 'metricas' | 'inventario';
const NAV: { id: Module; label: string; Icon: LucideIcon; to: (alt: string) => string }[] = [
  { id: 'tablero', label: 'Tablero', Icon: ConciergeBell, to: (a) => `/_proto/tablero/${a}` },
  { id: 'espacios', label: 'Espacios', Icon: MapIcon, to: () => '/_proto/editor' },
  { id: 'metricas', label: 'Métricas', Icon: ChartColumn, to: (a) => `/_proto/metricas/${a}` },
  { id: 'inventario', label: 'Inventario', Icon: Package, to: (a) => `/_proto/inventario/${a}` },
];

/** Alternativa activa de la URL (`/_proto/<pantalla>/<a|b|c>`); la navegación conserva la letra al cambiar de módulo. */
export function useAlt(): Alt {
  const { alt } = useParams();
  return alt === 'b' || alt === 'c' ? alt : 'a';
}
export type Alt = 'a' | 'b' | 'c';

/**
 * Shell: barra lateral `ink` (como el editor) y header blanco con negocio y título. `rail` la reduce a íconos para dar
 * ancho al plano en una tableta. Bajo `md` la navegación pasa al header.
 */
export function ProtoShell({ module, title, subtitle, actions, rail = false, children, className }: {
  module: Module; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; rail?: boolean; children: ReactNode; className?: string;
}) {
  const alt = useAlt();
  return (
    <div className={cn('grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-bg text-fg', rail ? 'md:grid-cols-[72px_minmax(0,1fr)]' : 'md:grid-cols-[196px_minmax(0,1fr)]')}>
      <nav aria-label="Módulos" className={cn('row-span-2 hidden flex-col gap-6 bg-ink py-5 text-warm md:flex', rail ? 'items-center px-2' : 'px-3')}>
        <div className={cn(!rail && 'px-2')}>{rail ? <span className="sr-only">Modivara</span> : <Wordmark dark />}{rail && <RailMark />}</div>
        {!rail && (
          <p className="px-2 text-sm leading-snug">
            <span className="block font-semibold">Bar Demo</span>
            <span className="text-warm/60">Local Principal</span>
          </p>
        )}
        <ul className="space-y-0.5">
          {NAV.map(({ id, label, Icon, to }) => (
            <li key={id}>
              <Link
                to={to(alt)} aria-current={id === module ? 'page' : undefined} title={rail ? label : undefined}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-md text-sm transition-colors',
                  rail ? 'w-12 justify-center' : 'px-2',
                  id === module ? 'bg-white/12 font-semibold' : 'text-warm/75 hover:bg-white/6',
                )}
              >
                <Icon aria-hidden className="size-[18px] shrink-0" />
                <span className={cn(rail && 'sr-only')}>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className={cn('mt-auto text-xs leading-relaxed text-warm/55', rail ? 'text-center' : 'px-2')}>
          {rail ? 'Laura' : <>Laura Gómez<br />Barra</>}
        </p>
      </nav>

      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-3 md:min-h-[72px] md:px-6">
        <div className="min-w-0">
          <p className="text-sm text-muted">{subtitle ?? 'Bar Demo'}</p>
          <h1 className="truncate text-2xl font-bold">{title}</h1>
        </div>
        {actions}
        <nav aria-label="Módulos" className="ml-auto flex gap-1 md:hidden">
          {NAV.map(({ id, label, Icon, to }) => (
            <Link key={id} to={to(alt)} aria-current={id === module ? 'page' : undefined} aria-label={label} className={cn('grid size-10 place-items-center rounded-md', id === module ? 'bg-ink text-warm' : 'text-muted hover:bg-sunken')}>
              <Icon aria-hidden className="size-5" />
            </Link>
          ))}
        </nav>
      </header>

      <main className={cn('min-w-0', className)}>{children}</main>
    </div>
  );
}

function RailMark() {
  return (
    <svg aria-hidden viewBox="0 0 26 10" className="h-2.5 w-7">
      <rect width="8" height="10" rx="2" className="fill-connect" />
      <rect x="9" width="8" height="10" rx="2" className="fill-interface" />
      <rect x="18" width="8" height="10" rx="2" className="fill-warm" />
    </svg>
  );
}

/** Control segmentado del editor (modo Diseñar/Actividad): el activo en `ink`. */
export function Segmented<T extends string>({ label, options, value, onChange, size = 'md' }: {
  label: string; options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-md border border-line bg-surface p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}
          className={cn('rounded px-3 font-semibold whitespace-nowrap transition-colors', size === 'sm' ? 'h-8 text-sm' : 'h-9 text-sm md:px-4', v === value ? 'bg-ink text-warm' : 'text-muted hover:bg-sunken')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/* ---------- Estados de la vista ---------- */

export type ViewState = 'ready' | 'loading' | 'empty' | 'error' | 'offline';
const STATES: [ViewState, string][] = [['ready', 'Con datos'], ['loading', 'Cargando'], ['empty', 'Vacío'], ['error', 'Error'], ['offline', 'Sin conexión']];

/**
 * Estado que ve la pantalla: el que fija el control del prototipo o, mientras dura la carga simulada (~700 ms al entrar y
 * cada vez que cambian `deps`, p. ej. un filtro), «loading». Simula la latencia de la API para revisar los esqueletos.
 */
export function useViewState(deps: readonly unknown[] = []) {
  const [forced, setForced] = useState<ViewState>('ready');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    setBusy(true);
    const t = setTimeout(() => setBusy(false), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const state: ViewState = forced === 'ready' && busy ? 'loading' : forced;
  const retry = () => { setForced('ready'); setBusy(true); setTimeout(() => setBusy(false), 700); };
  return { state, forced, setForced, retry };
}

/** Bloque de esqueleto: forma de lo que viene, sin texto. */
export function Bone({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden style={style} className={cn('skeleton h-4 rounded-md', className)} />;
}

export function EmptyState({ title, text, action, Icon }: { title: string; text: string; action?: ReactNode; Icon?: LucideIcon }) {
  return (
    <div className="anim-rise flex flex-col items-center gap-3 px-6 py-14 text-center">
      {Icon && <Icon aria-hidden className="size-8 text-line-strong" strokeWidth={1.5} />}
      <p className="font-display text-lg font-bold">{title}</p>
      <p className="max-w-sm text-muted">{text}</p>
      {action}
    </div>
  );
}

export function ErrorState({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="anim-rise flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="font-display text-lg font-bold">No se pudo cargar {what}</p>
      <p className="max-w-sm text-muted">El servidor no respondió. Lo que ya estaba guardado no se perdió.</p>
      <Button variant="secondary" onClick={onRetry}><RotateCw aria-hidden className="size-4" />Reintentar</Button>
    </div>
  );
}

/** Franja de sin conexión: el dato visible puede estar viejo; se dice desde cuándo. */
export function OfflineBanner({ since = 'hace 40 s' }: { since?: string }) {
  return (
    <p role="status" className="anim-rise flex items-center gap-2 border-b border-danger/30 bg-danger/8 px-4 py-2 text-sm font-semibold text-fg md:px-6">
      <WifiOff aria-hidden className="size-4 text-danger" />
      Sin conexión con el servidor {since}. Reintentando; lo que ves puede no estar al día.
    </p>
  );
}

/* ---------- Control del prototipo (fuera del diseño evaluado) ---------- */

export function ProtoControls({ screen, alts, view, children }: {
  screen: 'tablero' | 'metricas' | 'inventario';
  alts: Record<Alt, string>;
  view: { forced: ViewState; setForced: (s: ViewState) => void };
  children?: ReactNode;
}) {
  const alt = useAlt();
  return (
    <details className="fixed right-3 bottom-3 z-40 max-w-[calc(100vw-24px)] rounded-md border border-dashed border-line-strong bg-surface px-3 py-1.5 text-xs text-muted shadow-sm">
      <summary className="cursor-pointer">Prototipo: alternativa {alt.toUpperCase()}</summary>
      <div className="mt-2 flex w-64 flex-col gap-3 pb-1">
        <fieldset>
          <legend className="mb-1 font-semibold text-fg">Alternativa</legend>
          <ul className="space-y-1">
            {(Object.entries(alts) as [Alt, string][]).map(([a, name]) => (
              <li key={a}>
                <Link to={`/_proto/${screen}/${a}`} aria-current={a === alt ? 'page' : undefined} className={cn('block rounded px-1.5 py-1 hover:bg-sunken', a === alt && 'bg-sunken font-semibold text-fg')}>
                  {a.toUpperCase()}. {name}
                </Link>
              </li>
            ))}
          </ul>
        </fieldset>
        <fieldset>
          <legend className="mb-1 font-semibold text-fg">Estado de la vista</legend>
          <div className="flex flex-wrap gap-1">
            {STATES.map(([s, label]) => (
              <button key={s} type="button" aria-pressed={view.forced === s} onClick={() => view.setForced(s)} className={cn('rounded border border-line px-2 py-1', view.forced === s && 'border-ink bg-ink text-warm')}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {children && <div className="flex flex-wrap gap-1">{children}</div>}
        <Link to="/_proto" className="text-link underline">Todas las pantallas</Link>
      </div>
    </details>
  );
}

/** Escape cierra el diálogo o panel abierto. ponytail: sin trampa de foco; <dialog> nativo al pasar a pantallas reales. */
export function useEscape(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, onClose]);
}

/** Aviso breve tras una acción (se lee también por lector de pantalla). */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);
  const node = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-14 z-30 flex justify-center px-4">
      {msg && <p key={msg.key} className="anim-rise rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-warm shadow-lg">{msg.text}</p>}
    </div>
  );
  return { show: (text: string) => setMsg({ text, key: Date.now() }), node };
}
