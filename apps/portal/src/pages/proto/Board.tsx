import { BellRing, CheckCheck, HandHelping, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { ElementShape, RED_MS, SPACES, TABLES, areaAt, shortLabel, toneOf, type Space, type Tone } from './plan';
import { Bone, EmptyState, ErrorState, OfflineBanner, ProtoControls, ProtoShell, useToast, useViewState } from './shell';

// [DISEÑO] L-06 — tablero operativo sobre el plano publicado + cola global (ADR-003 ESP-23…ESP-30). Versión elegida (PLAN-002):
// «Todo el local a la vista», con la escena del editor (plan.tsx). Llamados locales; reconocer/finalizar y la pulsación se simulan.
// Las alternativas A y B descartadas se pueden recuperar del commit 9835a72.

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

/* ---------- Estado del tablero ---------- */

function useBoard() {
  const view = useViewState();
  const toast = useToast();
  const [calls, setCalls] = useState(INITIAL);
  const [now, setNow] = useState(Date.now());
  const [buttonsDown, setButtonsDown] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const live = view.state === 'empty' ? [] : calls;
  const queue = [...live].sort((a, b) => (a.status === b.status ? a.createdAt - b.createdAt : a.status === 'pending' ? -1 : 1));
  const callOf = new Map(live.map((c) => [c.tableId, c]));
  const offline = view.state === 'offline';

  return {
    view, toast, now, queue, callOf, offline, buttonsDown,
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
const CardBones = ({ n = 3 }: { n?: number }) => (
  <>{Array.from({ length: n }, (_, i) => <div key={i} aria-hidden className="h-28 rounded-lg border border-line bg-surface p-4"><Bone className="h-8 w-16" /><Bone className="mt-3 w-32" /><Bone className="mt-2 w-24" /></div>)}</>
);

const QueueEmpty = () => <EmptyState Icon={CheckCheck} title="Sin llamados activos" text="Cuando una mesa pulse su botón aparece aquí y se marca en el plano." />;

export default function Board() {
  const b = useBoard();
  const [selected, setSelected] = useState<string | null>(null);
  const loading = b.view.state === 'loading';
  const selSpace = selected ? tableOf(selected).spaceId : null;

  return (
    <ProtoShell
      module="tablero" rail title="Tablero"
      actions={<div className="flex flex-wrap items-center gap-3 md:order-last md:ml-auto">
        {!loading && <p className="text-sm text-muted"><span className="font-semibold text-fg tabular-nums">{b.pending.length}</span> esperando, <span className="font-semibold text-fg tabular-nums">{b.attending.length}</span> en atención</p>}
        <Connection b={b} />
      </div>}
    >
      {b.view.state === 'offline' && <OfflineBanner />}
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
      {b.toast.node}
      <ProtoControls view={b.view}>
        <Button size="sm" variant="secondary" onClick={b.simulatePress}>Simular pulsación</Button>
        <Button size="sm" variant="ghost" aria-pressed={b.buttonsDown} onClick={b.toggleButtons}>{b.buttonsDown ? 'Reconectar botones' : 'Desconectar botones'}</Button>
      </ProtoControls>
    </ProtoShell>
  );
}
