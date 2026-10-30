import { BellRing, HandHelping, List, Map as MapIcon, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { ElementShape, RED_MS, SPACES, TABLES, areaAt, shortLabel, toneOf, type Tone } from './plan';

// [DISEÑO] L-06 — tablero operativo sobre el plano publicado + cola global (ADR-003 ESP-23…ESP-30). Prototipo con llamados locales.

type Call = { id: string; tableId: string; status: 'pending' | 'in_progress'; createdAt: number; ackBy?: string };

const byLabel = new Map(TABLES.map((t) => [t.label, t]));
const spaceName = new Map(SPACES.map((s) => [s.id, s.name]));
const tableEls = new Map(SPACES.flatMap((s) => s.elements.flatMap((e) => (e.type === 'table' ? [[e.table_id, e] as const] : []))));
const placedIds = new Set(tableEls.keys());
const t0 = Date.now();
const seed = (label: string, status: Call['status'], agoS: number, ackBy?: string): Call =>
  ({ id: crypto.randomUUID(), tableId: byLabel.get(label)!.id, status, createdAt: t0 - agoS * 1000, ackBy });

const INITIAL: Call[] = [
  seed('Mesa 7', 'pending', 372),
  seed('Mesa 3', 'pending', 160),
  seed('Mesa 14', 'pending', 40),
  seed('Mesa 9', 'in_progress', 95, 'Laura'),
];

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};
const taker = (c: Call) => (c.ackBy === 'Tú' ? 'La tomaste tú' : `La tomó ${c.ackBy}`);
const TONE_TEXT: Record<Tone, string> = {
  idle: 'Sin llamados', new: 'Pendiente', waiting: 'Pendiente, más de 2 min', late: 'Pendiente, más de 5 min', attending: 'En atención',
};
// El color se concentra en las mesas del plano; tarjetas blancas con borde izquierdo y un chip de estado.
const EDGE: Record<Tone, string> = {
  idle: 'border-l-line', new: 'border-l-pending', waiting: 'border-l-pending', late: 'border-l-danger', attending: 'border-l-attending',
};
const box = (tone: Tone) => cn('border border-line border-l-8 bg-surface', EDGE[tone]);
const CHIP: Record<Tone, string> = {
  idle: 'text-muted', new: 'ring-2 ring-inset ring-pending', waiting: 'bg-pending text-pending-fg', late: 'bg-danger text-danger-fg', attending: 'bg-attending text-attending-fg',
};

function Chip({ tone, className }: { tone: Tone; className?: string }) {
  const Icon = tone === 'attending' ? HandHelping : BellRing;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap', CHIP[tone], className)}>
      {tone !== 'idle' && <Icon aria-hidden className="size-4" />}
      {TONE_TEXT[tone]}
    </span>
  );
}

export default function Board() {
  const [calls, setCalls] = useState(INITIAL);
  const [now, setNow] = useState(Date.now());
  const [spaceId, setSpaceId] = useState(SPACES[0]!.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'plan' | 'list'>('plan');
  const [buttonsDown, setButtonsDown] = useState(false);
  const [notice, setNotice] = useState('');
  const [elsewhere, setElsewhere] = useState<Call | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const callOf = new Map(calls.map((c) => [c.tableId, c]));
  const tableOf = (id: string) => TABLES.find((t) => t.id === id)!;
  const toneFor = (c: Call | undefined) => toneOf(c?.status, c ? now - c.createdAt : 0);
  const queue = [...calls].sort((a, b) => (a.status === b.status ? a.createdAt - b.createdAt : a.status === 'pending' ? -1 : 1));
  const focus = queue.find((c) => c.status === 'pending');
  const space = SPACES.find((s) => s.id === spaceId)!;

  function go(c: Call) {
    const t = tableOf(c.tableId);
    if (placedIds.has(t.id)) setSpaceId(t.spaceId);
    setSelected(t.id);
    setView(placedIds.has(t.id) ? 'plan' : 'list');
    if (elsewhere?.id === c.id) setElsewhere(null);
  }

  function acknowledge(c: Call) {
    setCalls((all) => all.map((x) => (x.id === c.id ? { ...x, status: 'in_progress', ackBy: 'Tú' } : x)));
    setNotice(`${tableOf(c.tableId).label} en atención.`);
  }

  function complete(c: Call) {
    setCalls((all) => all.filter((x) => x.id !== c.id));
    setNotice(`${tableOf(c.tableId).label} atendida. Sale de la cola y queda en el historial.`);
  }

  function simulatePress() {
    const free = TABLES.filter((t) => !callOf.has(t.id));
    const t = free[Math.floor(Math.random() * free.length)];
    if (!t) return;
    const c: Call = { id: crypto.randomUUID(), tableId: t.id, status: 'pending', createdAt: Date.now() };
    setCalls((all) => [...all, c]);
    setNotice(`${t.label} en espera.`);
    if (t.spaceId !== spaceId || !placedIds.has(t.id)) setElsewhere(c);
  }

  // `quiet`: en la cola el verde se reserva al foco, para no repetir el mismo botón llamativo en cada fila.
  const action = (c: Call, size: 'md' | 'lg' = 'lg', quiet = false) =>
    c.status === 'pending'
      ? <Button size={size} variant={quiet ? 'secondary' : 'primary'} onClick={() => acknowledge(c)}>Marcar en atención</Button>
      : <Button size={size} variant="secondary" onClick={() => complete(c)}>Finalizar</Button>;

  const where = (tableId: string) => {
    const t = tableOf(tableId);
    const el = tableEls.get(t.id);
    if (!el) return `${spaceName.get(t.spaceId)}, sin ubicar en el plano`;
    const area = areaAt(SPACES.find((s) => s.id === t.spaceId)?.areas, el);
    return area ? `${spaceName.get(t.spaceId)}, ${area.name}` : spaceName.get(t.spaceId);
  };

  const sel = selected ? callOf.get(selected) : undefined;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-3">
        <h1 className="text-lg font-bold">Bar Demo</h1>
        <nav aria-label="Espacios" className="flex gap-1">
          {SPACES.map((s) => {
            const pending = calls.filter((c) => c.status === 'pending' && tableOf(c.tableId).spaceId === s.id).length;
            return (
              <button
                key={s.id} type="button" aria-current={view === 'plan' && s.id === spaceId ? 'page' : undefined}
                aria-label={`${s.name}${pending ? `, ${pending} pendientes` : ''}`}
                onClick={() => { setSpaceId(s.id); setView('plan'); setSelected(null); if (elsewhere && tableOf(elsewhere.tableId).spaceId === s.id) setElsewhere(null); }}
                className={cn('flex h-12 items-center gap-2 rounded-md px-4 font-semibold', view === 'plan' && s.id === spaceId ? 'bg-ink text-warm' : 'text-muted hover:bg-sunken')}
              >
                {s.name}
                {pending > 0 && <span className="flex items-center gap-1 rounded-full bg-pending px-2 py-0.5 text-sm text-pending-fg tabular-nums"><BellRing aria-hidden className="size-3.5" />{pending}</span>}
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold', buttonsDown ? 'bg-danger text-danger-fg' : 'text-muted')}>
            {buttonsDown ? <WifiOff aria-hidden className="size-4" /> : <Wifi aria-hidden className="size-4" />}
            {buttonsDown ? 'Botones desconectados' : 'Botones conectados'}
          </span>
          <div role="group" aria-label="Vista" className="flex rounded-md border border-line">
            <Button size="sm" variant={view === 'plan' ? 'secondary' : 'ghost'} aria-pressed={view === 'plan'} onClick={() => setView('plan')}><MapIcon aria-hidden className="size-4" />Plano</Button>
            <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} aria-pressed={view === 'list'} onClick={() => setView('list')}><List aria-hidden className="size-4" />Lista</Button>
          </div>
        </div>
      </header>

      {/* Primer foco (ADR-003 §7): el pendiente más antiguo, con dónde está y cuánto lleva. */}
      <section aria-label="Llamado más antiguo" className={cn('flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4', box(focus ? toneFor(focus) : 'idle'))}>
        {focus ? (
          <>
            <p className="font-display text-5xl font-extrabold tabular-nums">{tableOf(focus.tableId).label}</p>
            <div className="space-y-1">
              <Chip tone={toneFor(focus)} className="text-base" />
              <p className="text-base tabular-nums text-muted">Esperando {fmt(now - focus.createdAt)} en {where(focus.tableId)}</p>
            </div>
            <div className="ml-auto flex gap-2">
              {tableOf(focus.tableId).spaceId !== spaceId && <Button size="lg" variant="secondary" onClick={() => go(focus)}>Ver en {spaceName.get(tableOf(focus.tableId).spaceId)}</Button>}
              {action(focus)}
            </div>
          </>
        ) : (
          <p className="text-lg font-semibold text-muted">Sin llamados pendientes</p>
        )}
      </section>

      <div className="grid flex-1 lg:grid-cols-[1fr_380px]">
        <section aria-label={view === 'plan' ? `Plano de ${space.name}` : 'Todas las mesas'} className="relative flex min-w-0 flex-col bg-sunken p-4">
          {elsewhere && (
            <p role="status" className={cn('mb-3 flex flex-wrap items-center gap-3 rounded-md px-4 py-2 font-semibold', box('new'))}>
              <BellRing aria-hidden className="size-5" />
              Nuevo llamado: {tableOf(elsewhere.tableId).label}, {where(elsewhere.tableId)}
              <Button size="sm" variant="secondary" onClick={() => go(elsewhere)}>Ir a la mesa</Button>
              <button type="button" aria-label="Cerrar aviso" onClick={() => setElsewhere(null)} className="ml-auto rounded p-1"><X aria-hidden className="size-4" /></button>
            </p>
          )}

          {view === 'plan' ? (
            <>
              <svg viewBox={`-20 -20 ${space.width + 40} ${space.height + 40}`} className="block max-h-[70dvh] w-full rounded-lg bg-surface" onClick={() => setSelected(null)}>
                {/* Áreas discretas: orientan sin competir con los llamados. */}
                {space.areas?.map((a) => (
                  <g key={a.id} aria-hidden>
                    <rect x={a.x} y={a.y} width={a.width} height={a.height} rx={14} fill="none" strokeWidth={1.5} className="stroke-line-strong/60 [stroke-dasharray:8_6]" />
                    <text x={a.x + 14} y={a.y + 26} className="fill-muted text-[16px] font-semibold">{a.name}</text>
                  </g>
                ))}
                {space.elements.map((e) => {
                  if (e.type !== 'table') return <ElementShape key={e.id} el={e} />;
                  const c = callOf.get(e.table_id);
                  const tone = toneFor(c);
                  const waited = c ? now - c.createdAt : 0;
                  return (
                    <g
                      key={e.id} role="button" tabIndex={0} className={cn('cursor-pointer', selected === e.table_id && 'outline-3 outline-focus')}
                      aria-label={`${tableOf(e.table_id).label}: ${TONE_TEXT[tone]}${c?.status === 'pending' ? `, ${fmt(waited)}` : ''}`}
                      onClick={(ev) => { ev.stopPropagation(); setSelected(e.table_id); }}
                      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setSelected(e.table_id))}
                    >
                      <ElementShape
                        el={e} tone={tone}
                        note={c?.status === 'pending' ? `${Math.floor(waited / 60_000)} min` : c ? 'Atención' : undefined}
                        progress={c?.status === 'pending' ? waited / RED_MS : undefined}
                      />
                    </g>
                  );
                })}
              </svg>
              <ul aria-label="Leyenda" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
                {(['idle', 'new', 'waiting', 'late', 'attending'] as const).map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className={cn('size-4 rounded-full border-2', { idle: 'border-line-strong', new: 'border-pending', waiting: 'border-pending bg-pending', late: 'border-danger bg-danger', attending: 'border-attending' }[t])} />
                    {TONE_TEXT[t]}
                  </li>
                ))}
              </ul>
              {selected && (
                <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center gap-4 rounded-lg border border-line-strong bg-surface p-4 shadow-lg">
                  <p className="font-display text-3xl font-extrabold">{tableOf(selected).label}</p>
                  <p className="text-base">
                    <Chip tone={toneFor(sel)} />
                    {sel?.status === 'pending' && <span className="tabular-nums">, esperando {fmt(now - sel.createdAt)}</span>}
                    {sel?.status === 'in_progress' && <span>, {taker(sel).toLowerCase()}</span>}
                  </p>
                  <div className="ml-auto flex gap-2">
                    {sel && action(sel, 'md')}
                    <Button variant="ghost" aria-label="Cerrar" onClick={() => setSelected(null)}><X aria-hidden className="size-5" /></Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-6">
              {SPACES.map((s) => (
                <section key={s.id} aria-label={s.name}>
                  <h2 className="mb-2 text-base font-bold">{s.name}</h2>
                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {TABLES.filter((t) => t.spaceId === s.id).map((t) => {
                      const c = callOf.get(t.id);
                      const tone = toneFor(c);
                      return (
                        <li key={t.id} className={cn('flex flex-wrap items-center gap-3 rounded-lg p-3', box(tone), selected === t.id && 'outline-3 outline-focus')}>
                          <span className="w-12 font-display text-2xl font-extrabold tabular-nums">{shortLabel(t.label)}</span>
                          <span className="flex-1 space-y-1 text-sm">
                            <Chip tone={tone} />
                            {c?.status === 'pending' && <span className="block tabular-nums text-muted">{fmt(now - c.createdAt)}</span>}
                            {!placedIds.has(t.id) && <span className="block text-muted">Sin ubicar en el plano</span>}
                          </span>
                          {c && action(c, 'md')}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>

        {/* Cola global: siempre visible, aunque el plano falle o no esté publicado (ESP-27, RNF-04). */}
        <aside aria-labelledby="queue" className="order-first border-b border-line bg-surface p-4 lg:order-none lg:border-b-0 lg:border-l">
          <h2 id="queue" className="mb-3 text-lg font-bold">Llamados activos <span className="text-muted tabular-nums">({calls.length})</span></h2>
          {queue.length === 0 && <p className="text-muted">Cuando una mesa llame, aparece aquí.</p>}
          <ol className="space-y-2">
            {queue.map((c) => {
              const tone = toneFor(c);
              return (
                <li key={c.id} className={cn('rounded-lg p-3', box(tone))}>
                  <button type="button" onClick={() => go(c)} className="flex w-full items-start gap-3 text-left">
                    <span className="font-display text-3xl leading-none font-extrabold tabular-nums">{shortLabel(tableOf(c.tableId).label)}</span>
                    <span className="flex-1 space-y-1 text-sm">
                      <Chip tone={tone} />
                      <span className="block text-muted">{where(c.tableId)}</span>
                      <span className="block tabular-nums text-muted">{c.status === 'pending' ? `Esperando ${fmt(now - c.createdAt)}` : taker(c)}</span>
                    </span>
                  </button>
                  <div className="mt-2 flex justify-end">{action(c, 'md', true)}</div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>

      <p className="sr-only" role="status" aria-live="polite">{notice}</p>

      <footer aria-label="Controles del prototipo" className="flex flex-wrap items-center gap-3 border-t border-dashed border-line-strong px-4 py-3 text-sm text-muted">
        <span>Controles del prototipo (no aparecen en el producto):</span>
        <Button size="sm" variant="secondary" onClick={simulatePress}>Simular pulsación al azar</Button>
        <Button size="sm" variant="ghost" aria-pressed={buttonsDown} onClick={() => setButtonsDown(!buttonsDown)}>{buttonsDown ? 'Reconectar botones' : 'Desconectar botones'}</Button>
        <Link to="/_proto/editor" className="ml-auto text-link underline">Abrir el editor de espacios</Link>
      </footer>
    </div>
  );
}
