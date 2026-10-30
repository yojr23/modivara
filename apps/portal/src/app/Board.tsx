import type { ServiceCallDto } from '@modivara/hospitality-contracts';
import {
  callErrorState, useAcknowledgeCall, useActiveCalls, useCompleteCall, useConnectionStatus, useGatewaysStatus, useLayouts, useTables, useZones,
} from '@modivara/hospitality-web';
import { BellRing, CheckCheck, HandHelping, Map as MapIcon, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { DEFAULT_SPACE_NAME, ElementShape, RED_MS, areaAt, shortLabel, spaceIdOf, splitAreas, toneOf, type Space, type Tone } from './plan';
import { Bone, EmptyState, ErrorState, OfflineBanner, Page, useApp, useToast } from './ui';

// L-06 — tablero operativo (ADR-003 ESP-23…ESP-30), versión «todo el local a la vista» (PLAN-002): todos los planos publicados
// lado a lado y la cola global abajo, siempre visible aunque no haya plano. REST + tiempo real (`service_call.changed`).

type Call = ServiceCallDto;

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
  const { me, location, can } = useApp();
  const l = location.id;
  const toast = useToast();
  const layouts = useLayouts(l);
  const zones = useZones(l);
  const tables = useTables(l);
  const calls = useActiveCalls(l);
  const ack = useAcknowledgeCall(l);
  const done = useCompleteCall(l);
  const status = useConnectionStatus();
  const gateways = useGatewaysStatus();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const zoneName = new Map((zones.data ?? []).map((z) => [z.id, z.name]));
  const order = new Map((zones.data ?? []).map((z) => [z.id, z.position]));
  const spaces: Space[] = useMemo(() => (layouts.data ?? [])
    // «Salón principal» (zona null) solo mientras tenga mesas, como en el editor: si todas pasaron a pisos, su plano viejo no se muestra.
    .filter((x) => x.zone_id !== null || (tables.data ?? []).some((t) => t.zone_id === null))
    .map((x) => ({ id: spaceIdOf(x.zone_id), zoneId: x.zone_id, name: x.zone_id ? zoneName.get(x.zone_id) ?? 'Espacio' : DEFAULT_SPACE_NAME, width: x.canvas_width, height: x.canvas_height, ...splitAreas(x.elements) }))
    .sort((a, b) => (a.zoneId === null ? -1 : b.zoneId === null ? 1 : (order.get(a.zoneId) ?? 0) - (order.get(b.zoneId) ?? 0) || a.name.localeCompare(b.name))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [layouts.data, zones.data, tables.data]);
  const tableById = new Map((tables.data ?? []).map((t) => [t.id, t]));
  const placedIn = new Map(spaces.flatMap((s) => s.elements.flatMap((e) => (e.type === 'table' ? [[e.table_id, { s, e }] as const] : []))));

  const queue = [...(calls.data ?? [])].sort((a, b) => (a.status === b.status ? a.created_at.localeCompare(b.created_at) : a.status === 'pending' ? -1 : 1));
  const callOf = new Map(queue.map((c) => [c.table_id, c]));
  const waited = (c: Call) => now - Date.parse(c.created_at);

  function onError(e: unknown) {
    const s = callErrorState(e);
    toast.show(s && 'current' in s ? 'Otra persona ya lo había actualizado; el tablero quedó al día.' : 'No se pudo guardar. Revisa la conexión y vuelve a intentar.');
  }

  return {
    me, now, toast, spaces, queue, callOf, waited, status, gateways,
    loading: layouts.isPending || tables.isPending || calls.isPending,
    layoutsError: layouts.isError, callsError: calls.isError,
    retry: () => { void layouts.refetch(); void calls.refetch(); void tables.refetch(); void zones.refetch(); },
    canAck: can('hospitality.calls.acknowledge'), canComplete: can('hospitality.calls.complete'), canEdit: can('hospitality.tables.manage'),
    pending: queue.filter((c) => c.status === 'pending'),
    attending: queue.filter((c) => c.status === 'in_progress'),
    /** El pendiente más antiguo: el único con botón primario (una sola acción llamativa por vista). */
    focus: queue.find((c) => c.status === 'pending'),
    tone: (c: Call | undefined) => toneOf(c?.status, c ? waited(c) : 0),
    pendingIn: (spaceId: string) => queue.filter((c) => c.status === 'pending' && placedIn.get(c.table_id)?.s.id === spaceId).length,
    label: (tableId: string) => tableById.get(tableId)?.label ?? 'Mesa',
    placed: (tableId: string) => placedIn.has(tableId),
    /** «Primer piso, Barra»; las mesas fuera de los planos publicados siguen en la cola. */
    where(c: Call) {
      const p = placedIn.get(c.table_id);
      if (!p) return `${c.table_display_name}, sin ubicar en el plano`;
      const area = areaAt(p.s.areas, p.e);
      return area ? `${p.s.name}, ${area.name}` : p.s.name;
    },
    taker: (c: Call) => (c.acknowledged_by === me.actor.user_id ? 'La tomaste tú' : `La tomó ${c.acknowledged_by_name ?? 'otra persona'}`),
    busy: ack.isPending || done.isPending,
    acknowledge: (c: Call) => ack.mutate(c.id, { onSuccess: () => toast.show(`${tableById.get(c.table_id)?.label ?? 'Mesa'} en atención`), onError }),
    complete: (c: Call) => done.mutate(c.id, { onSuccess: () => toast.show(`${tableById.get(c.table_id)?.label ?? 'Mesa'} atendida. Queda en el historial.`), onError }),
  };
}
type Board = ReturnType<typeof useBoard>;

function Action({ b, c, size = 'md', primary = false, className }: { b: Board; c: Call; size?: 'sm' | 'md' | 'lg'; primary?: boolean; className?: string }) {
  const offline = b.status === 'disconnected';
  const title = offline ? 'Sin conexión: se podrá cuando vuelva' : undefined;
  if (c.status === 'pending') {
    if (!b.canAck) return null;
    return <Button size={size} variant={primary ? 'primary' : 'secondary'} disabled={offline || b.busy} title={title} className={className} onClick={() => b.acknowledge(c)}><HandHelping aria-hidden className="size-4" />Marcar en atención</Button>;
  }
  if (!b.canComplete) return null;
  return <Button size={size} variant="ghost" disabled={offline || b.busy} title={title} className={cn('border border-line', className)} onClick={() => b.complete(c)}><CheckCheck aria-hidden className="size-4" />Finalizar</Button>;
}

function Connection({ b }: { b: Board }) {
  if (b.status === 'disconnected') return <Pill down icon={<WifiOff aria-hidden className="size-4" />}>Sin conexión</Pill>;
  if (b.gateways === 'some_disconnected') return <Pill down icon={<WifiOff aria-hidden className="size-4" />}>Botones desconectados</Pill>;
  if (b.gateways === 'no_gateways') return <Pill icon={<WifiOff aria-hidden className="size-4" />}>Sin botones instalados</Pill>;
  if (b.status === 'connecting') return <Pill icon={<Wifi aria-hidden className="size-4" />}>Conectando…</Pill>;
  return <Pill icon={<Wifi aria-hidden className="size-4" />}>{b.gateways === 'all_connected' ? 'Botones conectados' : 'En línea'}</Pill>;
}
const Pill = ({ down = false, icon, children }: { down?: boolean; icon: ReactNode; children: ReactNode }) => (
  <span role="status" className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold transition-colors', down ? 'bg-danger text-danger-fg' : 'text-muted')}>{icon}{children}</span>
);

/* ---------- Plano en modo operativo ---------- */

function PlanView({ b, space, selected, onSelect, className }: { b: Board; space: Space; selected: string | null; onSelect: (id: string | null) => void; className?: string }) {
  return (
    <svg viewBox={`-24 -24 ${space.width + 48} ${space.height + 48}`} aria-label={`Plano de ${space.name}`} className={cn('block h-full w-full', className)} onClick={() => onSelect(null)}>
      <rect x={-8} y={-8} width={space.width + 16} height={space.height + 16} rx={12} className="fill-surface" />
      {/* Áreas discretas: orientan sin competir con los llamados. */}
      {space.areas.map((a) => (
        <g key={a.id} aria-hidden>
          <rect x={a.x} y={a.y} width={a.width} height={a.height} rx={14} fill="none" strokeWidth={1.5} className="stroke-line-strong/50 [stroke-dasharray:8_6]" />
          <text x={a.x + 14} y={a.y + 26} className="fill-muted text-[16px] font-semibold">{a.name}</text>
        </g>
      ))}
      {space.elements.map((e) => {
        if (e.type !== 'table') return <ElementShape key={e.id} el={e} />;
        const c = b.callOf.get(e.table_id);
        const tone = b.tone(c);
        const waited = c ? b.waited(c) : 0;
        const cx = e.x + e.width / 2;
        const cy = e.y + e.height / 2;
        const r = Math.max(e.width, e.height) / 2 + 12;
        const on = selected === e.table_id;
        return (
          <g
            key={e.id} role="button" tabIndex={0} aria-pressed={on} className="cursor-pointer outline-none [&:focus-visible>.focus]:opacity-100"
            aria-label={`${b.label(e.table_id)}: ${TONE_TEXT[tone]}${c?.status === 'pending' ? `, esperando ${fmt(waited)}` : ''}`}
            onClick={(ev) => { ev.stopPropagation(); onSelect(e.table_id); }}
            onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onSelect(e.table_id))}
          >
            {/* Llamado recién llegado: tres ondas y se detiene (no compite después). */}
            {c?.status === 'pending' && waited < 6000 && <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={4} className="anim-ripple stroke-pending" style={{ ['--r0' as string]: `${r}px` }} />}
            <ElementShape el={e} label={b.label(e.table_id)} tone={tone} note={c?.status === 'pending' ? mins(waited) : c ? 'Atención' : undefined} progress={c?.status === 'pending' ? waited / RED_MS : undefined} />
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
        <p className="font-display text-3xl font-extrabold">{b.label(tableId)}</p>
        {c && <p className="text-sm text-muted">{b.where(c)}</p>}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-base">
        <Chip tone={tone} />
        {c?.status === 'pending' && <span className="tabular-nums">esperando {fmt(b.waited(c))}</span>}
        {c?.status === 'in_progress' && <span>{b.taker(c)}</span>}
        {c && c.press_count > 1 && <span className="text-sm text-muted">Pulsó {c.press_count} veces</span>}
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
  <>{Array.from({ length: n }, (_, i) => <div key={i} aria-hidden className="h-16 rounded-lg border border-line bg-surface p-3 md:w-64"><Bone className="h-6 w-12" /><Bone className="mt-2 w-32" /></div>)}</>
);

export default function Board() {
  const b = useBoard();
  const [selected, setSelected] = useState<string | null>(null);
  const selSpace = selected ? b.spaces.find((s) => s.elements.some((e) => e.type === 'table' && e.table_id === selected))?.id : null;

  return (
    <Page
      id="tablero" rail title="Tablero"
      actions={<div className="flex flex-wrap items-center gap-3 md:order-last md:ml-auto">
        {!b.loading && <p className="text-sm text-muted"><span className="font-semibold text-fg tabular-nums">{b.pending.length}</span> esperando, <span className="font-semibold text-fg tabular-nums">{b.attending.length}</span> en atención</p>}
        <Connection b={b} />
      </div>}
    >
      {b.status === 'disconnected' && <OfflineBanner />}
      <div className="flex flex-col md:h-[calc(100dvh-73px)]">
        <div className="hidden min-h-0 flex-1 gap-3 bg-sunken p-3 md:grid" style={{ gridTemplateColumns: b.spaces.length ? b.spaces.map((s) => `minmax(0,${s.width}fr)`).join(' ') : '1fr' }}>
          {b.loading ? <PlanBones /> : b.layoutsError ? <div className="rounded-xl bg-surface"><ErrorState what="los planos" onRetry={b.retry} /></div> : b.spaces.length === 0 ? (
            <div className="grid place-items-center rounded-xl bg-surface">
              <EmptyState Icon={MapIcon} title="Aún no hay planos publicados" text="Los llamados llegan igual a la cola de abajo. Cuando se publique el plano de un espacio, las mesas se verán aquí."
                action={b.canEdit && <Button asChild variant="secondary"><Link to="../espacios" relative="path">Ir a Espacios</Link></Button>} />
            </div>
          ) : b.spaces.map((s) => {
            const n = b.pendingIn(s.id);
            return (
              // ponytail: los pisos se reparten el ancho; con más de dos o tres se achican. Desplazamiento o un piso por pantalla si molesta.
              <section key={s.id} aria-label={`Plano de ${s.name}`} className="relative flex min-h-0 flex-col rounded-xl bg-surface">
                <h2 className="flex items-center gap-2 px-4 pt-3 text-base font-bold">
                  {s.name}
                  {n > 0 && <span className="flex items-center gap-1 rounded-full bg-pending px-2 py-0.5 text-xs text-pending-fg tabular-nums"><BellRing aria-hidden className="size-3" />{n} esperando</span>}
                </h2>
                <div className="min-h-0 flex-1 p-1"><PlanView b={b} space={s} selected={selected} onSelect={setSelected} className="anim-rise" /></div>
                {selected && selSpace === s.id && <TableSheet b={b} tableId={selected} onClose={() => setSelected(null)} className="absolute inset-x-3 bottom-3" />}
              </section>
            );
          })}
        </div>

        {/* Cola como franja: el orden es la prioridad; tocar una tarjeta abre la mesa en su plano. Siempre visible (ESP-27). */}
        <section aria-labelledby="queue" className="border-t border-line bg-surface px-3 py-3">
          <div className="mb-2 flex items-center gap-4 px-1">
            <h2 id="queue" className="text-base font-bold">Cola de llamados</h2>
            <Legend className="hidden text-xs lg:flex" />
          </div>
          <ol className="flex flex-col gap-2 md:flex-row md:overflow-x-auto md:pb-1">
            {b.loading ? <CardBones n={4} /> : b.callsError ? <li className="w-full"><ErrorState what="los llamados" onRetry={b.retry} /></li> : b.queue.length === 0 ? (
              <li className="w-full"><EmptyState Icon={CheckCheck} title="Sin llamados activos" text="Cuando una mesa pulse su botón aparece aquí y se marca en el plano." /></li>
            ) : b.queue.map((c) => {
              const tone = b.tone(c);
              const on = selected === c.table_id;
              return (
                <li key={c.id} className={cn('anim-rise flex shrink-0 flex-wrap items-center gap-3 p-2.5 pr-3 md:w-64 md:flex-nowrap', card(tone), on && 'ring-2 ring-focus')}>
                  <button type="button" onClick={() => setSelected(c.table_id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-label={`${b.label(c.table_id)}, ${c.status === 'pending' ? `esperando ${fmt(b.waited(c))}` : b.taker(c).replace(/^L/, 'l')}, ${b.where(c)}`}>
                    <span className="font-display text-3xl leading-none font-extrabold tabular-nums">{shortLabel(b.label(c.table_id))}</span>
                    <span className="min-w-0 text-sm">
                      <span className="block truncate font-semibold tabular-nums">{c.status === 'pending' ? fmt(b.waited(c)) : b.taker(c)}</span>
                      <span className="block truncate text-muted">{b.where(c)}</span>
                    </span>
                  </button>
                  {/* En celular no hay plano y una mesa sin ubicar no tiene hoja: la acción va en la fila. */}
                  <Action b={b} c={c} primary={c.id === b.focus?.id} size={b.placed(c.table_id) ? 'md' : 'sm'} className={b.placed(c.table_id) ? 'basis-full md:hidden' : 'basis-full md:basis-auto'} />
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
    </Page>
  );
}
