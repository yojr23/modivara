import { BellRing, CheckCheck, HandHelping, Map as MapIcon, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { ElementShape, RED_MS, SPACES, TABLES, areaAt, shortLabel, toneOf, type Space, type Tone } from './plan';
import { Bone, EmptyState, ErrorState, OfflineBanner, ProtoControls, ProtoShell, useAlt, useEscape, useToast, useViewState } from './shell';

// [DISEÑO] L-06 — tablero operativo sobre el plano publicado + cola global (ADR-003 ESP-23…ESP-30). Tres alternativas (PLAN-002)
// con la escena del editor (plan.tsx): pisos, áreas y mesas. Llamados locales; reconocer/finalizar y la pulsación se simulan.

const ALTS = { a: 'Plano y cola', b: 'Cola protagonista', c: 'Todo el local a la vista' };

type Call = { id: string; tableId: string; status: 'pending' | 'in_progress'; createdAt: number; ackBy?: string };

const byLabel = new Map(TABLES.map((t) => [t.label, t]));
const tableOf = (id: string) => TABLES.find((t) => t.id === id)!;
const spaceOf = (id: string) => SPACES.find((s) => s.id === id)!;
const tableEls = new Map(SPACES.flatMap((s) => s.elements.flatMap((e) => (e.type === 'table' ? [[e.table_id, e] as const] : []))));
const t0 = Date.now();
const seed = (label: string, status: Call['status'], agoS: number, ackBy?: string): Call =>
  ({ id: crypto.randomUUID(), tableId: byLabel.get(label)!.id, status, createdAt: t0 - agoS * 1000, ackBy });
const INITIAL: Call[] = [seed('Mesa 7', 'pending', 372), seed('Mesa 3', 'pending', 160), seed('Mesa 14', 'pending', 40), seed('Mesa 9', 'in_progress', 95, 'Laura')];

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};
const mins = (ms: number) => `${Math.floor(ms / 60_000)} min`;
const TONE_TEXT: Record<Tone, string> = {
  idle: 'Sin llamados', new: 'Pendiente', waiting: 'Pendiente, más de 2 min', late: 'Pendiente, más de 5 min', attending: 'En atención',
};
// El color fuerte se concentra en las mesas del plano; tarjetas blancas con borde izquierdo y un chip de estado.
const EDGE: Record<Tone, string> = { idle: 'border-l-line', new: 'border-l-pending', waiting: 'border-l-pending', late: 'border-l-danger', attending: 'border-l-attending' };
const card = (tone: Tone) => cn('rounded-lg border border-line border-l-[6px] bg-surface', EDGE[tone]);
const CHIP: Record<Tone, string> = {
  idle: 'text-muted', new: 'ring-2 ring-inset ring-pending', waiting: 'bg-pending text-pending-fg', late: 'bg-danger text-danger-fg', attending: 'bg-attending text-attending-fg',
};

function Chip({ tone, className }: { tone: Tone; className?: string }) {
  const Icon = tone === 'attending' ? HandHelping : BellRing;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap transition-colors', CHIP[tone], className)}>
      {tone !== 'idle' && <Icon aria-hidden className="size-4" />}
      {TONE_TEXT[tone]}
    </span>
  );
}

/* ---------- Estado compartido de las tres alternativas ---------- */

function useBoard() {
  const view = useViewState();
  const toast = useToast();
  const [calls, setCalls] = useState(INITIAL);
  const [now, setNow] = useState(Date.now());
  const [buttonsDown, setButtonsDown] = useState(false);
  const [arrived, setArrived] = useState<Call | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const live = view.state === 'empty' ? [] : calls;
  const queue = [...live].sort((a, b) => (a.status === b.status ? a.createdAt - b.createdAt : a.status === 'pending' ? -1 : 1));
  const callOf = new Map(live.map((c) => [c.tableId, c]));
  const offline = view.state === 'offline';

  return {
    view, toast, now, queue, callOf, offline, buttonsDown, arrived, setArrived,
    pending: queue.filter((c) => c.status === 'pending'),
    attending: queue.filter((c) => c.status === 'in_progress'),
    /** El pendiente más antiguo: el único con botón primario (una sola acción llamativa por vista). */
    focus: queue.find((c) => c.status === 'pending'),
    tone: (c: Call | undefined) => toneOf(c?.status, c ? now - c.createdAt : 0),
    pendingIn: (spaceId: string) => live.filter((c) => c.status === 'pending' && tableOf(c.tableId).spaceId === spaceId).length,
    acknowledge(c: Call) {
      setCalls((all) => all.map((x) => (x.id === c.id ? { ...x, status: 'in_progress', ackBy: 'Tú' } : x)));
      toast.show(`${tableOf(c.tableId).label} en atención`);
    },
    complete(c: Call) {
      setCalls((all) => all.filter((x) => x.id !== c.id));
      toast.show(`${tableOf(c.tableId).label} atendida. Queda en el historial.`);
    },
    simulatePress() {
      const free = TABLES.filter((t) => !callOf.has(t.id));
      const t = free[Math.floor(Math.random() * free.length)];
      if (!t) return;
      const c: Call = { id: crypto.randomUUID(), tableId: t.id, status: 'pending', createdAt: Date.now() };
      setCalls((all) => [...all, c]);
      setArrived(c);
    },
    toggleButtons: () => setButtonsDown((v) => !v),
  };
}
type Board = ReturnType<typeof useBoard>;

const where = (tableId: string) => {
  const t = tableOf(tableId);
  const s = spaceOf(t.spaceId);
  const el = tableEls.get(t.id);
  if (!el) return `${s.name}, sin ubicar en el plano`;
  const area = areaAt(s.areas, el);
  return area ? `${s.name}, ${area.name}` : s.name;
};
const taker = (c: Call) => (c.ackBy === 'Tú' ? 'La tomaste tú' : `La tomó ${c.ackBy}`);

function Action({ b, c, size = 'md', primary = false, className }: { b: Board; c: Call; size?: 'sm' | 'md' | 'lg'; primary?: boolean; className?: string }) {
  const title = b.offline ? 'Sin conexión: se podrá cuando vuelva' : undefined;
  return c.status === 'pending'
    ? <Button size={size} variant={primary ? 'primary' : 'secondary'} disabled={b.offline} title={title} className={className} onClick={() => b.acknowledge(c)}><HandHelping aria-hidden className="size-4" />Marcar en atención</Button>
    : <Button size={size} variant="ghost" disabled={b.offline} title={title} className={cn('border border-line', className)} onClick={() => b.complete(c)}><CheckCheck aria-hidden className="size-4" />Finalizar</Button>;
}

function Connection({ b }: { b: Board }) {
  const down = b.offline || b.buttonsDown;
  const text = b.offline ? 'Sin conexión' : b.buttonsDown ? 'Botones desconectados' : 'Botones conectados';
  return (
    <span role="status" className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold transition-colors', down ? 'bg-danger text-danger-fg' : 'text-muted')}>
      {down ? <WifiOff aria-hidden className="size-4" /> : <Wifi aria-hidden className="size-4" />}
      {text}
    </span>
  );
}

/** Pestañas de piso con sus pendientes: ningún llamado queda oculto por estar en otro espacio. */
function FloorTabs({ b, spaceId, onChange }: { b: Board; spaceId: string; onChange: (id: string) => void }) {
  return (
    <div role="group" aria-label="Espacios" className="flex shrink-0 rounded-md border border-line bg-surface p-0.5">
      {SPACES.map((s) => {
        const n = b.pendingIn(s.id);
        return (
          <button
            key={s.id} type="button" aria-pressed={s.id === spaceId} aria-label={`${s.name}${n ? `, ${n} pendientes` : ''}`} onClick={() => onChange(s.id)}
            className={cn('flex h-10 items-center gap-2 rounded px-4 text-sm font-semibold transition-colors', s.id === spaceId ? 'bg-ink text-warm' : 'text-muted hover:bg-sunken')}
          >
            {s.name}
            {n > 0 && <span className="flex items-center gap-1 rounded-full bg-pending px-1.5 text-xs text-pending-fg tabular-nums"><BellRing aria-hidden className="size-3" />{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Plano en modo operativo ---------- */

function PlanView({ b, space, selected, onSelect, className }: { b: Board; space: Space; selected: string | null; onSelect: (id: string | null) => void; className?: string }) {
  return (
    <svg viewBox={`-24 -24 ${space.width + 48} ${space.height + 48}`} aria-label={`Plano de ${space.name}`} className={cn('block h-full w-full', className)} onClick={() => onSelect(null)}>
      <rect x={-8} y={-8} width={space.width + 16} height={space.height + 16} rx={12} className="fill-surface" />
      {/* Áreas discretas: orientan sin competir con los llamados. */}
      {space.areas?.map((a) => (
        <g key={a.id} aria-hidden>
          <rect x={a.x} y={a.y} width={a.width} height={a.height} rx={14} fill="none" strokeWidth={1.5} className="stroke-line-strong/50 [stroke-dasharray:8_6]" />
          <text x={a.x + 14} y={a.y + 26} className="fill-muted text-[16px] font-semibold">{a.name}</text>
        </g>
      ))}
      {space.elements.map((e) => {
        if (e.type !== 'table') return <ElementShape key={e.id} el={e} />;
        const c = b.callOf.get(e.table_id);
        const tone = b.tone(c);
        const waited = c ? b.now - c.createdAt : 0;
        const cx = e.x + e.width / 2;
        const cy = e.y + e.height / 2;
        const r = Math.max(e.width, e.height) / 2 + 12;
        const on = selected === e.table_id;
        return (
          <g
            key={e.id} role="button" tabIndex={0} aria-pressed={on} className="cursor-pointer outline-none [&:focus-visible>.focus]:opacity-100"
            aria-label={`${tableOf(e.table_id).label}: ${TONE_TEXT[tone]}${c?.status === 'pending' ? `, esperando ${fmt(waited)}` : ''}`}
            onClick={(ev) => { ev.stopPropagation(); onSelect(e.table_id); }}
            onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onSelect(e.table_id))}
          >
            {/* Llamado recién llegado: tres ondas y se detiene (no compite después). */}
            {c?.status === 'pending' && waited < 6000 && <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={4} className="anim-ripple stroke-pending" style={{ ['--r0' as string]: `${r}px` }} />}
            <ElementShape el={e} tone={tone} note={c?.status === 'pending' ? mins(waited) : c ? 'Atención' : undefined} progress={c?.status === 'pending' ? waited / RED_MS : undefined} />
            <circle cx={cx} cy={cy} r={r + 8} fill="none" strokeWidth={3} className={cn('focus stroke-focus transition-opacity', on ? 'opacity-100' : 'opacity-0')} />
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ className }: { className?: string }) {
  return (
    <ul aria-label="Leyenda" className={cn('flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted', className)}>
      {(['idle', 'new', 'waiting', 'late', 'attending'] as const).map((t) => (
        <li key={t} className="flex items-center gap-2">
          <span aria-hidden className={cn('size-4 rounded-full border-2', { idle: 'border-line-strong', new: 'border-pending', waiting: 'border-pending bg-pending', late: 'border-danger bg-danger', attending: 'border-attending' }[t])} />
          {TONE_TEXT[t]}
        </li>
      ))}
    </ul>
  );
}

/** Hoja de la mesa tocada: estado, espera y la acción que corresponde. */
function TableSheet({ b, tableId, onClose, className }: { b: Board; tableId: string; onClose: () => void; className?: string }) {
  const c = b.callOf.get(tableId);
  const tone = b.tone(c);
  return (
    <div className={cn('anim-rise flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-line-strong bg-surface p-4 shadow-lg', className)}>
      <div>
        <p className="font-display text-3xl font-extrabold">{tableOf(tableId).label}</p>
        <p className="text-sm text-muted">{where(tableId)}</p>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-base">
        <Chip tone={tone} />
        {c?.status === 'pending' && <span className="tabular-nums">esperando {fmt(b.now - c.createdAt)}</span>}
        {c?.status === 'in_progress' && <span>{taker(c)}</span>}
      </p>
      <div className="ml-auto flex gap-2">
        {c && <Action b={b} c={c} primary={c.id === b.focus?.id} />}
        <Button variant="ghost" aria-label="Cerrar" onClick={onClose}><X aria-hidden className="size-5" /></Button>
      </div>
    </div>
  );
}

const PlanBones = () => (
  <div aria-hidden className="flex h-full min-h-72 flex-col gap-4 rounded-xl bg-surface p-6">
    <Bone className="w-32" />
    <div className="grid flex-1 grid-cols-4 place-items-center gap-6">
      {Array.from({ length: 8 }, (_, i) => <Bone key={i} className="size-16 rounded-full" />)}
    </div>
  </div>
);
const CardBones = ({ n = 3, tall = false }: { n?: number; tall?: boolean }) => (
  <>{Array.from({ length: n }, (_, i) => <div key={i} aria-hidden className={cn('rounded-lg border border-line bg-surface p-4', tall ? 'h-52' : 'h-28')}><Bone className="h-8 w-16" /><Bone className="mt-3 w-32" /><Bone className="mt-2 w-24" /></div>)}</>
);

function Shell({ b, children, actions, title = 'Tablero' }: { b: Board; children: ReactNode; actions?: ReactNode; title?: string }) {
  return (
    <ProtoShell module="tablero" rail title={title} actions={<div className="flex flex-wrap items-center gap-3 md:order-last md:ml-auto">{actions}<Connection b={b} /></div>}>
      {b.view.state === 'offline' && <OfflineBanner />}
      {children}
      {b.toast.node}
      <ProtoControls screen="tablero" alts={ALTS} view={b.view}>
        <Button size="sm" variant="secondary" onClick={b.simulatePress}>Simular pulsación</Button>
        <Button size="sm" variant="ghost" aria-pressed={b.buttonsDown} onClick={b.toggleButtons}>{b.buttonsDown ? 'Reconectar botones' : 'Desconectar botones'}</Button>
      </ProtoControls>
    </ProtoShell>
  );
}

const QueueEmpty = () => <EmptyState Icon={CheckCheck} title="Sin llamados activos" text="Cuando una mesa pulse su botón aparece aquí y se marca en el plano." />;

/* ---------- A · Plano y cola ---------- */

function BoardA() {
  const b = useBoard();
  const [spaceId, setSpaceId] = useState(SPACES[0]!.id);
  const [selected, setSelected] = useState<string | null>(null);
  const space = spaceOf(spaceId);
  const loading = b.view.state === 'loading';
  const elsewhere = b.arrived && tableOf(b.arrived.tableId).spaceId !== spaceId && b.callOf.get(b.arrived.tableId)?.status === 'pending' ? b.arrived : null;

  function go(c: Call) {
    setSpaceId(tableOf(c.tableId).spaceId);
    setSelected(c.tableId);
    b.setArrived(null);
  }

  return (
    <Shell b={b} actions={<div className="hidden md:block"><FloorTabs b={b} spaceId={spaceId} onChange={(id) => { setSpaceId(id); setSelected(null); }} /></div>}>
      <div className="grid md:h-[calc(100dvh-73px)] md:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label={`Plano de ${space.name}`} className="relative hidden min-h-0 flex-col gap-3 bg-sunken p-4 md:flex">
          {elsewhere && (
            <p role="status" className={cn('anim-rise flex flex-wrap items-center gap-3 px-4 py-2 font-semibold', card('new'))}>
              <BellRing aria-hidden className="size-5 text-pending" />
              Nuevo llamado: {tableOf(elsewhere.tableId).label}, {where(elsewhere.tableId)}
              <Button size="sm" variant="secondary" onClick={() => go(elsewhere)}>Ir a la mesa</Button>
              <button type="button" aria-label="Cerrar aviso" onClick={() => b.setArrived(null)} className="ml-auto rounded p-1 hover:bg-sunken"><X aria-hidden className="size-4" /></button>
            </p>
          )}
          {loading ? <PlanBones /> : b.view.state === 'error' ? (
            <div className="grid flex-1 place-items-center rounded-xl bg-surface"><ErrorState what="el plano" onRetry={b.view.retry} /></div>
          ) : (
            <>
              <div className="anim-rise min-h-0 flex-1"><PlanView b={b} space={space} selected={selected} onSelect={setSelected} /></div>
              <Legend />
            </>
          )}
          {selected && !loading && <TableSheet b={b} tableId={selected} onClose={() => setSelected(null)} className="absolute inset-x-4 bottom-4" />}
        </section>

        {/* Cola global: siempre visible, aunque el plano falle o no esté publicado (ESP-27, RNF-04). */}
        <aside aria-labelledby="queue-a" className="flex min-h-0 flex-col border-line bg-surface md:border-l">
          <h2 id="queue-a" className="flex items-baseline gap-2 px-4 pt-4 pb-3 text-lg font-bold">
            Llamados activos {!loading && <span className="text-muted tabular-nums">{b.queue.length}</span>}
          </h2>
          <ol className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {loading ? <CardBones /> : b.queue.length === 0 ? <QueueEmpty /> : b.queue.map((c) => {
              const tone = b.tone(c);
              const isFocus = c.id === b.focus?.id;
              return (
                <li key={c.id} className={cn('anim-rise p-3 transition-shadow', card(tone), selected === c.tableId && 'ring-2 ring-focus')}>
                  <button type="button" onClick={() => go(c)} className="flex w-full items-start gap-3 text-left">
                    <span className={cn('font-display leading-none font-extrabold tabular-nums', isFocus ? 'text-5xl' : 'text-3xl')}>{shortLabel(tableOf(c.tableId).label)}</span>
                    <span className="flex-1 space-y-1 text-sm">
                      <Chip tone={tone} />
                      <span className="block text-muted">{where(c.tableId)}</span>
                      <span className="block tabular-nums text-muted">{c.status === 'pending' ? `Esperando ${fmt(b.now - c.createdAt)}` : taker(c)}</span>
                    </span>
                  </button>
                  <div className="mt-2 flex justify-end"><Action b={b} c={c} primary={isFocus} size={isFocus ? 'lg' : 'md'} className={cn(isFocus && 'w-full')} /></div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </Shell>
  );
}

/* ---------- B · Cola protagonista ---------- */

const MINI_TONE: Record<Tone, string> = { idle: 'fill-sunken stroke-line', new: 'fill-pending stroke-pending', waiting: 'fill-pending stroke-pending', late: 'fill-danger stroke-danger', attending: 'fill-attending stroke-attending' };

/** Plano en miniatura: solo contornos y la mesa del llamado marcada. Responde «dónde» sin tener que leer el plano grande. */
function MiniPlan({ tableId, tone }: { tableId: string; tone: Tone }) {
  const s = spaceOf(tableOf(tableId).spaceId);
  return (
    <svg viewBox={`-10 -10 ${s.width + 20} ${s.height + 20}`} role="img" aria-label={`Ubicación de ${tableOf(tableId).label} en ${s.name}`} className="h-full w-full">
      <rect width={s.width} height={s.height} rx={14} className="fill-bg" />
      {s.areas?.map((a) => <rect key={a.id} x={a.x} y={a.y} width={a.width} height={a.height} rx={14} fill="none" strokeWidth={4} className="stroke-line [stroke-dasharray:14_10]" />)}
      {s.elements.map((e) => {
        if (e.type === 'label') return null;
        const target = e.type === 'table' && e.table_id === tableId;
        const cls = e.type === 'table' ? (target ? MINI_TONE[tone] : 'fill-surface stroke-line-strong/60') : e.type === 'wall' ? 'fill-line-strong/50 stroke-none' : 'fill-sunken stroke-line';
        const cx = e.x + e.width / 2;
        const cy = e.y + e.height / 2;
        return (
          <g key={e.id} transform={`rotate(${e.rotation} ${cx} ${cy})`}>
            {target && <circle cx={cx} cy={cy} r={Math.max(e.width, e.height) / 2 + 26} strokeWidth={6} className={cn('fill-none', tone === 'late' ? 'stroke-danger/40' : tone === 'attending' ? 'stroke-attending/40' : 'stroke-pending/50')} />}
            {e.type === 'table' && e.shape === 'round'
              ? <ellipse cx={cx} cy={cy} rx={e.width / 2} ry={e.height / 2} strokeWidth={target ? 6 : 3} className={cls} />
              : <rect x={e.x} y={e.y} width={e.width} height={e.height} rx={6} strokeWidth={target ? 6 : 3} className={cls} />}
          </g>
        );
      })}
    </svg>
  );
}

function BoardB() {
  const b = useBoard();
  const [planOpen, setPlanOpen] = useState(false);
  useEscape(() => setPlanOpen(false), planOpen);
  const [spaceId, setSpaceId] = useState(SPACES[0]!.id);
  const [selected, setSelected] = useState<string | null>(null);
  const loading = b.view.state === 'loading';

  function open(c?: Call) {
    if (c) { setSpaceId(tableOf(c.tableId).spaceId); setSelected(c.tableId); }
    setPlanOpen(true);
  }

  return (
    <Shell b={b} actions={<Button variant="secondary" onClick={() => open()}><MapIcon aria-hidden className="size-4" />Ver plano</Button>}>
      <div className="space-y-8 p-4 md:p-6">
        <section aria-labelledby="waiting-b">
          <h2 id="waiting-b" className="mb-3 flex items-baseline gap-2 text-lg font-bold">
            Esperando {!loading && <span className="text-muted tabular-nums">{b.pending.length}</span>}
          </h2>
          {loading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><CardBones tall /></div> : b.view.state === 'empty' || b.pending.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line-strong bg-surface"><QueueEmpty /></div>
          ) : (
            <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {b.pending.map((c) => {
                const tone = b.tone(c);
                const isFocus = c.id === b.focus?.id;
                return (
                  <li key={c.id} className={cn('anim-rise flex flex-col overflow-hidden', card(tone))}>
                    <div className="flex gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-6xl leading-none font-extrabold tabular-nums">{shortLabel(tableOf(c.tableId).label)}</p>
                        <p className="mt-2 truncate text-sm text-muted">{where(c.tableId)}</p>
                        <p className="mt-3 font-display text-2xl font-bold tabular-nums">{fmt(b.now - c.createdAt)}</p>
                        <Chip tone={tone} className="mt-2" />
                      </div>
                      <button type="button" onClick={() => open(c)} aria-label={`Ver ${tableOf(c.tableId).label} en el plano`} className="h-28 w-36 shrink-0 rounded-md border border-line p-1 hover:border-line-strong">
                        <MiniPlan tableId={c.tableId} tone={tone} />
                      </button>
                    </div>
                    <div className="mt-auto border-t border-line p-3"><Action b={b} c={c} primary={isFocus} size="lg" className="w-full" /></div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {!loading && b.attending.length > 0 && (
          <section aria-labelledby="attending-b">
            <h2 id="attending-b" className="mb-3 flex items-baseline gap-2 text-lg font-bold">En atención <span className="text-muted tabular-nums">{b.attending.length}</span></h2>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {b.attending.map((c) => (
                <li key={c.id} className={cn('anim-rise flex items-center gap-3 p-3', card('attending'))}>
                  <span className="font-display text-3xl font-extrabold tabular-nums">{shortLabel(tableOf(c.tableId).label)}</span>
                  <span className="min-w-0 flex-1 text-sm"><span className="block truncate">{taker(c)}</span><span className="block truncate text-muted">{where(c.tableId)}</span></span>
                  <Action b={b} c={c} size="sm" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {planOpen && (
        <div className="fixed inset-0 z-30 flex justify-end bg-ink/30" onClick={() => setPlanOpen(false)}>
          <section role="dialog" aria-modal aria-label="Plano del local" onClick={(e) => e.stopPropagation()} className="anim-slide flex h-full w-[min(860px,100vw)] flex-col gap-3 bg-sunken p-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <FloorTabs b={b} spaceId={spaceId} onChange={(id) => { setSpaceId(id); setSelected(null); }} />
              <Button variant="ghost" aria-label="Cerrar plano" className="ml-auto" onClick={() => setPlanOpen(false)}><X aria-hidden className="size-5" /></Button>
            </div>
            <div className="relative min-h-0 flex-1">
              <PlanView b={b} space={spaceOf(spaceId)} selected={selected} onSelect={setSelected} />
              {selected && <TableSheet b={b} tableId={selected} onClose={() => setSelected(null)} className="absolute inset-x-2 bottom-2" />}
            </div>
            <Legend />
          </section>
        </div>
      )}
    </Shell>
  );
}

/* ---------- C · Todo el local a la vista ---------- */

function BoardC() {
  const b = useBoard();
  const [selected, setSelected] = useState<string | null>(null);
  const loading = b.view.state === 'loading';
  const selSpace = selected ? tableOf(selected).spaceId : null;

  return (
    <Shell b={b} actions={!loading && <p className="text-sm text-muted"><span className="font-semibold text-fg tabular-nums">{b.pending.length}</span> esperando, <span className="font-semibold text-fg tabular-nums">{b.attending.length}</span> en atención</p>}>
      <div className="flex flex-col md:h-[calc(100dvh-73px)]">
        <div className="hidden min-h-0 flex-1 gap-3 bg-sunken p-3 md:grid md:grid-cols-[1.25fr_1fr]">
          {SPACES.map((s) => {
            const n = b.pendingIn(s.id);
            return (
              <section key={s.id} aria-label={`Plano de ${s.name}`} className="relative flex min-h-0 flex-col rounded-xl bg-surface">
                <h2 className="flex items-center gap-2 px-4 pt-3 text-base font-bold">
                  {s.name}
                  {n > 0 && <span className="flex items-center gap-1 rounded-full bg-pending px-2 py-0.5 text-xs text-pending-fg tabular-nums"><BellRing aria-hidden className="size-3" />{n} esperando</span>}
                </h2>
                <div className="min-h-0 flex-1 p-1">
                  {loading ? <PlanBones /> : b.view.state === 'error' ? <ErrorState what="el plano" onRetry={b.view.retry} /> : <PlanView b={b} space={s} selected={selected} onSelect={setSelected} className="anim-rise" />}
                </div>
                {selected && selSpace === s.id && <TableSheet b={b} tableId={selected} onClose={() => setSelected(null)} className="absolute inset-x-3 bottom-3" />}
              </section>
            );
          })}
        </div>

        {/* Cola como franja: el orden es la prioridad; tocar una tarjeta abre la mesa en su plano. */}
        <section aria-labelledby="queue-c" className="border-t border-line bg-surface px-3 py-3">
          <div className="mb-2 flex items-center gap-4 px-1">
            <h2 id="queue-c" className="text-base font-bold">Cola de llamados</h2>
            <Legend className="hidden text-xs lg:flex" />
          </div>
          <ol className="flex flex-col gap-2 md:flex-row md:overflow-x-auto md:pb-1">
            {loading ? <CardBones n={4} /> : b.queue.length === 0 ? <li className="w-full"><QueueEmpty /></li> : b.queue.map((c) => {
              const tone = b.tone(c);
              const on = selected === c.tableId;
              return (
                <li key={c.id} className={cn('anim-rise flex shrink-0 flex-wrap items-center gap-3 p-2.5 pr-3 md:w-64 md:flex-nowrap', card(tone), on && 'ring-2 ring-focus')}>
                  <button type="button" onClick={() => setSelected(c.tableId)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="font-display text-3xl leading-none font-extrabold tabular-nums">{shortLabel(tableOf(c.tableId).label)}</span>
                    <span className="min-w-0 text-sm">
                      <span className="block truncate font-semibold tabular-nums">{c.status === 'pending' ? fmt(b.now - c.createdAt) : taker(c)}</span>
                      <span className="block truncate text-muted">{where(c.tableId)}</span>
                    </span>
                  </button>
                  {/* En celular no hay plano: la acción va en la fila. */}
                  <Action b={b} c={c} primary={c.id === b.focus?.id} className="basis-full md:hidden" />
                  <span title={TONE_TEXT[tone]} className={cn('hidden size-8 shrink-0 place-items-center rounded-full md:grid', CHIP[tone])}>
                    {tone === 'attending' ? <HandHelping aria-hidden className="size-4" /> : <BellRing aria-hidden className="size-4" />}
                    <span className="sr-only">{TONE_TEXT[tone]}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </Shell>
  );
}

export default function Board() {
  const alt = useAlt();
  return alt === 'b' ? <BoardB /> : alt === 'c' ? <BoardC /> : <BoardA />;
}
