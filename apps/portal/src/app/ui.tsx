import type { MeResponse } from '@modivara/core-contracts';
import { LogOut, RotateCw, WifiOff, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';

// Piezas comunes de las pantallas del portal: shell (barra lateral `ink` y header blanco, el lenguaje del editor de espacios),
// esqueletos, estados vacío/error/sin conexión, avisos y control segmentado.

export type Location = MeResponse['locations'][number];
export type Permission = Location['permissions'][number];
export type NavItem = { id: string; label: string; Icon: LucideIcon; to: string };

/** Sesión, local activo y navegación permitida; lo arma `AppShell` (routes) a partir de `/me`. */
export type AppContextValue = {
  me: MeResponse;
  location: Location;
  setLocationId: (id: string) => void;
  can: (p: Permission) => boolean;
  nav: NavItem[];
  logout: () => void;
};
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp requiere AppShell');
  return v;
}

export function Wordmark({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg aria-hidden viewBox="0 0 26 10" className="h-2.5 w-7">
        <rect width="8" height="10" rx="2" className="fill-connect" />
        <rect x="9" width="8" height="10" rx="2" className="fill-interface" />
        <rect x="18" width="8" height="10" rx="2" className={dark ? 'fill-warm' : 'fill-ink'} />
      </svg>
      <span className={cn('font-display text-lg font-extrabold tracking-tight', compact && 'sr-only')}>Modivara</span>
    </span>
  );
}

/**
 * Página del portal: barra lateral `ink` y header blanco con negocio y título. `rail` reduce la barra a íconos para dar ancho
 * al plano en una tableta. Bajo `md` la navegación pasa al header.
 */
export function Page({ id, title, subtitle, actions, rail = false, children, className }: {
  id: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; rail?: boolean; children: ReactNode; className?: string;
}) {
  const { me, location, setLocationId, nav, logout } = useApp();
  return (
    <div className={cn('grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-bg text-fg', rail ? 'md:grid-cols-[72px_minmax(0,1fr)]' : 'md:grid-cols-[196px_minmax(0,1fr)]')}>
      <nav aria-label="Módulos" className={cn('row-span-2 hidden flex-col gap-6 bg-ink py-5 text-warm md:flex', rail ? 'items-center px-2' : 'px-3')}>
        <div className={cn(!rail && 'px-2')}><Wordmark dark compact={rail} /></div>
        {!rail && (
          <div className="px-2 text-sm leading-snug">
            <span className="block font-semibold">{me.organization?.name}</span>
            {me.locations.length > 1 ? (
              <select aria-label="Local" value={location.id} onChange={(e) => setLocationId(e.target.value)} className="mt-1 w-full rounded bg-white/8 px-1 py-1 text-warm">
                {me.locations.map((l) => <option key={l.id} value={l.id} className="text-fg">{l.name}</option>)}
              </select>
            ) : <span className="text-warm/60">Local {location.name}</span>}
          </div>
        )}
        <ul className="space-y-0.5">
          {nav.map(({ id: navId, label, Icon, to }) => (
            <li key={navId}>
              <Link
                to={to} aria-current={navId === id ? 'page' : undefined} title={rail ? label : undefined}
                className={cn('flex h-10 items-center gap-3 rounded-md text-sm transition-colors', rail ? 'w-12 justify-center' : 'px-2', navId === id ? 'bg-white/12 font-semibold' : 'text-warm/75 hover:bg-white/6')}
              >
                <Icon aria-hidden className="size-[18px] shrink-0" />
                <span className={cn(rail && 'sr-only')}>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className={cn('mt-auto text-xs leading-relaxed text-warm/55', rail ? 'text-center' : 'px-2')}>
          {!rail && <span className="mb-1 block">{me.actor.display_name}</span>}
          <button type="button" onClick={logout} title="Salir" className={cn('flex items-center gap-1.5 rounded py-1 text-warm/75 hover:text-warm', rail && 'mx-auto')}>
            <LogOut aria-hidden className="size-4" /><span className={cn(rail && 'sr-only')}>Salir</span>
          </button>
        </div>
      </nav>

      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-3 md:min-h-[72px] md:px-6">
        <div className="min-w-0">
          <p className="text-sm text-muted">{subtitle ?? me.organization?.name}</p>
          <h1 className="truncate text-2xl font-bold">{title}</h1>
        </div>
        {actions}
        <nav aria-label="Módulos" className="ml-auto flex gap-1 md:hidden">
          {nav.map(({ id: navId, label, Icon, to }) => (
            <Link key={navId} to={to} aria-current={navId === id ? 'page' : undefined} aria-label={label} className={cn('grid size-10 place-items-center rounded-md', navId === id ? 'bg-ink text-warm' : 'text-muted hover:bg-sunken')}>
              <Icon aria-hidden className="size-5" />
            </Link>
          ))}
          <button type="button" onClick={logout} aria-label="Salir" className="grid size-10 place-items-center rounded-md text-muted hover:bg-sunken"><LogOut aria-hidden className="size-5" /></button>
        </nav>
      </header>

      <main className={cn('min-w-0', className)}>{children}</main>
    </div>
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

/** Franja de sin conexión: lo que se ve puede no estar al día. */
export function OfflineBanner() {
  return (
    <p role="status" className="anim-rise flex items-center gap-2 border-b border-danger/30 bg-danger/8 px-4 py-2 text-sm font-semibold text-fg md:px-6">
      <WifiOff aria-hidden className="size-4 text-danger" />
      Sin conexión en tiempo real. Reintentando; lo que ves puede no estar al día.
    </p>
  );
}

/** Escape cierra el diálogo o panel abierto. ponytail: sin trampa de foco; `<dialog>` nativo si hace falta. */
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
