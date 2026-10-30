import type { RangePreset } from '@modivara/analytics-contracts';
import { analyticsApi, analyticsKeys, useInventoryMetrics, useServiceCallMetrics } from '@modivara/analytics-web';
import type { Unit } from '@modivara/commerce-contracts';
import { useMovements, useProducts, useReasons } from '@modivara/commerce-web';
import { useLayouts, useTables, useZones } from '@modivara/hospitality-web';
import { useQueries } from '@tanstack/react-query';
import { ChartColumn, Info } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { cn } from '@/ui/cn';
import { Columns, Figure, InOutColumns, RankBars, SeqScale, seq } from './charts';
import { bucketLabel, fmtNum, fmtQty, fmtSeconds, fmtSigned, fmtWhen, unitWord } from './format';
import { DEFAULT_SPACE_NAME, ElementShape, areaAt, areaTotals, spaceIdOf, splitAreas, type Space } from './plan';
import { Bone, EmptyState, ErrorState, Page, Segmented, useApp } from './ui';

// F5-12 — métricas básicas, versión «sobre el plano» (PLAN-002): el plano publicado teñido por llamados por área (suma de sus mesas)
// y detalle de área o mesa; inventario por producto. Rótulos fieles a lo medido: «hasta En atención» es un registro, no la llegada.

type Tab = 'calls' | 'stock';
const RANGE_OPTIONS = [['today', 'Hoy'], ['yesterday', 'Ayer'], ['last_7_days', '7 días'], ['last_30_days', '30 días']] as const;
const LEAD: Record<RangePreset, string> = { today: 'Hoy', yesterday: 'Ayer', last_7_days: 'En los últimos 7 días', last_30_days: 'En los últimos 30 días', custom: 'En el período' };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const CALLS_NOTE = '«En atención» y «Atendida» son los momentos en que alguien del personal lo registró en el tablero; no miden la llegada a la mesa. Las áreas suman los llamados de las mesas que hoy están dentro de cada una.';
const MIXED_UNITS_NOTE = 'Las cantidades se muestran por producto porque cada uno tiene su unidad (botellas, kg); para todo el local se cuentan movimientos.';
const periodData = (by: { bucket_start: string; calls: number }[], g: 'hour' | 'day') => by.map((p) => ({ label: bucketLabel(p.bucket_start, g), value: p.calls }));

function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0', className)}>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-bold">{title}</h2>
        {aside && <p className="text-sm text-muted">{aside}</p>}
      </div>
      {children}
    </section>
  );
}

/** Lo que el número no dice: va una vez, al pie, en lugar de repetir advertencias en cada cifra. */
const Footnote = ({ children }: { children: ReactNode }) => (
  <p className="flex gap-2 border-t border-line pt-4 text-sm text-muted"><Info aria-hidden className="mt-0.5 size-4 shrink-0" /><span>{children}</span></p>
);
const ChartBones = ({ h = 'h-28' }: { h?: string }) => (
  <div aria-hidden className="space-y-3"><Bone className="w-40" /><div className={cn('flex items-end gap-2', h)}>{[40, 65, 50, 80, 72, 95, 60, 45, 70, 85, 55, 30].map((v, i) => <Bone key={i} className="flex-1 rounded-b-none" style={{ height: `${v}%` }} />)}</div></div>
);
const FigureBones = () => (
  <div aria-hidden className="grid grid-cols-2 gap-6">{Array.from({ length: 4 }, (_, i) => <div key={i} className="space-y-2"><Bone className="w-24" /><Bone className="h-8 w-20" /></div>)}</div>
);
const PageBones = () => (
  <div aria-busy aria-label="Cargando métricas" className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]"><Bone className="h-[60dvh] rounded-xl" /><div className="space-y-6 p-2"><FigureBones /><ChartBones /></div></div>
);

/* ---------- Llamados sobre el plano ---------- */

/** El plano publicado teñido por llamados: área = un solo tono según su total; cada mesa lleva su número. */
function HeatPlan({ space, counts, label, selected, onSelect }: { space: Space; counts: Map<string, number>; label: (id: string) => string; selected: string | null; onSelect: (id: string | null) => void }) {
  const totals = areaTotals(space.areas, space.elements, (id) => counts.get(id) ?? 0);
  const maxArea = Math.max(1, ...totals.values());
  return (
    <svg viewBox={`-24 -24 ${space.width + 48} ${space.height + 48}`} aria-label={`Llamados en ${space.name}`} className="block h-full w-full" onClick={() => onSelect(null)}>
      <rect x={-8} y={-8} width={space.width + 16} height={space.height + 16} rx={12} className="fill-surface" />
      {space.areas.map((a) => {
        const n = totals.get(a.id) ?? 0;
        const on = selected === a.id;
        return (
          <g key={a.id} role="button" tabIndex={0} aria-pressed={on} aria-label={`Área ${a.name}: ${n} llamados`} className="cursor-pointer outline-none"
            onClick={(e) => { e.stopPropagation(); onSelect(a.id); }} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(a.id))}>
            <rect x={a.x} y={a.y} width={a.width} height={a.height} rx={14} strokeWidth={on ? 3 : 1.5} className={cn('transition-[fill] duration-300', on ? 'stroke-focus' : 'stroke-interface/40')} style={{ fill: seq((0.8 * n) / maxArea) }} />
            <text x={a.x + 14} y={a.y + 26} className="fill-fg text-[17px] font-bold">{a.name}</text>
            <text x={a.x + a.width - 14} y={a.y + 26} textAnchor="end" className="fill-fg text-[17px] font-bold tabular-nums">{n}</text>
          </g>
        );
      })}
      {space.elements.map((e) => {
        if (e.type !== 'table') return <ElementShape key={e.id} el={e} />;
        const on = selected === e.table_id;
        return (
          <g key={e.id} role="button" tabIndex={0} aria-pressed={on} aria-label={`${label(e.table_id)}: ${counts.get(e.table_id) ?? 0} llamados`} className="cursor-pointer outline-none"
            onClick={(ev) => { ev.stopPropagation(); onSelect(e.table_id); }} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onSelect(e.table_id))}>
            <ElementShape el={e} label={label(e.table_id)} note={`${counts.get(e.table_id) ?? 0}`} />
            {on && <rect x={e.x - 8} y={e.y - 8} width={e.width + 16} height={e.height + 16} rx={12} fill="none" strokeWidth={3} className="stroke-focus" />}
          </g>
        );
      })}
    </svg>
  );
}

function CallsOnPlan({ range }: { range: RangePreset }) {
  const { location } = useApp();
  const l = location.id;
  const layouts = useLayouts(l);
  const zones = useZones(l);
  const tables = useTables(l);
  const all = useServiceCallMetrics(l, { range });
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const zoneName = new Map((zones.data ?? []).map((z) => [z.id, z.name]));
  const spaces: Space[] = (layouts.data ?? []).filter((x) => x.zone_id !== null || (tables.data ?? []).some((t) => t.zone_id === null)).map((x) => ({ id: spaceIdOf(x.zone_id), zoneId: x.zone_id, name: x.zone_id ? zoneName.get(x.zone_id) ?? 'Espacio' : DEFAULT_SPACE_NAME, width: x.canvas_width, height: x.canvas_height, ...splitAreas(x.elements) }));
  const space = spaces.find((s) => s.id === spaceId) ?? spaces[0];
  const tableName = new Map((tables.data ?? []).map((t) => [t.id, t.label]));
  const label = (id: string) => tableName.get(id) ?? 'Mesa';
  const area = space?.areas.find((a) => a.id === selected);
  const table = selected && !area ? selected : null;
  const one = useServiceCallMetrics(l, { range, table_id: table ?? undefined });

  if (all.isPending || layouts.isPending) return <PageBones />;
  if (all.isError) return <ErrorState what="las métricas" onRetry={() => void all.refetch()} />;
  if (all.data.totals.calls === 0) return <EmptyState Icon={ChartColumn} title="Sin llamados en este período" text="Cuando las mesas pulsen su botón, aquí verás cuántos llamados hubo y cuánto tardó cada paso. Prueba un período más largo." />;

  const counts = new Map(all.data.by_table.map((r) => [r.table_id, r.calls]));
  const inArea = area && space ? new Set(space.elements.flatMap((e) => (e.type === 'table' && areaAt([area], e) ? [e.table_id] : []))) : null;
  const d = table ? one.data : all.data;
  const rows = all.data.by_table.filter((r) => !inArea || inArea.has(r.table_id));
  const title = table ? label(table) : area ? area.name : 'Todo el local';
  const totals = space ? areaTotals(space.areas, space.elements, (id) => counts.get(id) ?? 0) : new Map();
  const where = table ? all.data.by_table.find((r) => r.table_id === table)?.zone_name ?? '' : area ? space?.name : LEAD[range];

  return (
    <div className="grid min-h-0 lg:h-[calc(100dvh-73px)] lg:grid-cols-[minmax(0,1fr)_380px]">
      <section aria-label="Plano con llamados" className="flex min-h-[420px] flex-col gap-3 bg-sunken p-4">
        {space ? (
          <>
            <div className="flex flex-wrap items-center gap-4">
              {spaces.length > 1 && <Segmented label="Espacio" options={spaces.map((s) => [s.id, s.name] as const)} value={space.id} onChange={(id) => { setSpaceId(id); setSelected(null); }} />}
              {space.areas.length > 0 && <SeqScale max={Math.max(1, ...totals.values())} unit="llamados por área" />}
            </div>
            <div className="min-h-0 flex-1"><HeatPlan space={space} counts={counts} label={label} selected={selected} onSelect={setSelected} /></div>
            <p className="text-sm text-muted">Toca un área o una mesa para ver su detalle. El número de cada mesa es su total de llamados en el período.</p>
          </>
        ) : (
          <div className="grid flex-1 place-items-center rounded-xl bg-surface">
            <EmptyState title="Sin plano publicado" text="Publica el plano en Espacios para ver los llamados sobre el local. El detalle de la derecha funciona igual." />
          </div>
        )}
      </section>
      <aside aria-label={`Detalle de ${title}`} className="space-y-8 overflow-y-auto border-line bg-surface p-5 lg:border-l">
        <div key={selected ?? 'all'} className="anim-rise space-y-8">
          <div>
            <p className="text-sm text-muted">{where}</p>
            <h2 className="font-display text-3xl font-bold">{title}</h2>
            {selected && <button type="button" className="mt-1 text-sm font-semibold text-link" onClick={() => setSelected(null)}>Ver todo el local</button>}
          </div>
          {area ? (
            <Figure label="Llamados" value={fmtNum(totals.get(area.id) ?? 0)} context="Suma de las mesas del área. Los tiempos se ven por mesa o para todo el local." />
          ) : !d ? <FigureBones /> : (
            <div className="grid grid-cols-2 gap-6">
              <Figure label="Llamados" value={fmtNum(d.totals.calls)} />
              <Figure label="Mediana hasta «En atención»" value={fmtSeconds(d.time_to_acknowledge.median_seconds)} />
              <Figure label="Mediana hasta «Atendida»" value={fmtSeconds(d.time_to_complete.median_seconds)} />
              <Figure label="Con pulsaciones repetidas" value={`${pct(d.totals.calls_with_repeated_presses, d.totals.calls)} %`} />
            </div>
          )}
          {d && !area && (
            <Section title={d.group_by === 'hour' ? 'Por hora' : 'Por día'}>
              <Columns data={periodData(d.by_period, d.group_by)} caption={`Llamados de ${title}`} unit={['llamado', 'llamados']} height={120} labelEvery={d.group_by === 'hour' ? 4 : d.by_period.length > 7 ? 5 : 1} current={range === 'yesterday' ? undefined : d.by_period.length - 1} />
            </Section>
          )}
          {!table && (
            <Section title="Mesas">
              <RankBars caption={`Mesas de ${title}`} selected={selected} onSelect={setSelected} rows={rows.slice(0, 10).map((r) => ({ id: r.table_id, label: r.table_label, text: r.table_label, value: r.calls }))} />
            </Section>
          )}
          <Footnote>{CALLS_NOTE}</Footnote>
        </div>
      </aside>
    </div>
  );
}

/* ---------- Inventario por producto ---------- */

function StockByProduct({ range }: { range: RangePreset }) {
  const { location } = useApp();
  const l = location.id;
  const all = useInventoryMetrics(l, { range });
  const products = useProducts(l);
  const reasons = useReasons();
  const list = (all.data?.balances ?? []).map((b) => ({ id: b.product_id, name: b.product_name, balance: Number(b.balance) }));
  // ponytail: una consulta por producto para contar sus salidas (la API agrupa por motivo, no por producto). Con cientos de productos, agregar `by_product`.
  const perProduct = useQueries({
    queries: list.map((p) => ({ queryKey: analyticsKeys.inventory(l, { range, product_id: p.id }), queryFn: () => analyticsApi.inventoryMetrics(l, { range, product_id: p.id }), retry: false })),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const productId = chosen ?? list[0]?.id ?? null;
  const recent = useMovements(l, { productId: productId ?? undefined, limit: 5 });

  if (all.isPending) return <PageBones />;
  if (all.isError) return <ErrorState what="las métricas de inventario" onRetry={() => void all.refetch()} />;
  if (!list.length || !productId) return <EmptyState Icon={ChartColumn} title="Sin movimientos de stock" text="Las entradas, salidas y ajustes que se registren en Inventario aparecen aquí." />;

  const p = list.find((x) => x.id === productId)!;
  const unit: Unit = products.data?.find((x) => x.id === productId)?.unit ?? 'unit';
  const d = perProduct[list.indexOf(p)]?.data;
  const outs = (i: number) => perProduct[i]?.data?.by_direction.find((x) => x.direction === 'out')?.movement_count ?? 0;
  const days = d ? d.by_period.length * (d.group_by === 'hour' ? 1 / 24 : 1) : 1;
  const outQty = -Number(d?.by_direction.find((x) => x.direction === 'out')?.total_delta ?? 0);
  const reasonName = new Map((reasons.data ?? []).map((r) => [r.id, r.name]));

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
      <section aria-label="Salidas por producto" className="p-4 md:p-6">
        <h2 className="mb-1 text-lg font-bold">Salidas por producto</h2>
        <p className="mb-4 text-sm text-muted">{LEAD[range]}, número de salidas registradas. Elige un producto para ver sus cantidades.</p>
        <RankBars caption="Salidas por producto" selected={productId} onSelect={setChosen}
          rows={list.map((x, i) => ({ id: x.id, label: x.name, text: x.name, value: outs(i) })).sort((a, b) => b.value - a.value)} />
      </section>
      <aside key={productId} aria-label={`Detalle de ${p.name}`} className="anim-rise space-y-8 border-line bg-surface p-5 lg:min-h-[calc(100dvh-73px)] lg:border-l">
        <h2 className="font-display text-3xl font-bold">{p.name}</h2>
        <div className="grid grid-cols-2 gap-6">
          <Figure label="Saldo actual" value={fmtQty(p.balance, unit)} />
          <Figure label="Salidas por día" value={d ? fmtQty(Math.round((outQty / Math.max(1, days)) * 10) / 10, unit) : '—'} context="Promedio del período" />
        </div>
        <Section title="Entradas y salidas" aside={`En ${unitWord(unit, 2)}`}>
          {d ? <InOutColumns data={d.by_period.map((b) => ({ label: bucketLabel(b.bucket_start, d.group_by), in: Number(b.in_delta) + Math.max(0, Number(b.adjust_delta)), out: Number(b.out_delta) + Math.min(0, Number(b.adjust_delta)) }))} caption={`Entradas y salidas de ${p.name}`} height={130} labelEvery={d.by_period.length > 7 ? 4 : 1} /> : <ChartBones />}
        </Section>
        <Section title="Últimos movimientos">
          <ul className="divide-y divide-line text-sm">
            {(recent.data ?? []).map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                <span>{reasonName.get(x.reason_id) ?? (x.direction === 'in' ? 'Entrada' : x.direction === 'out' ? 'Salida' : 'Ajuste')}<span className="block text-xs text-muted">{fmtWhen(x.occurred_at)}</span></span>
                <span className="font-semibold tabular-nums">{fmtSigned(x.delta, unit)}</span>
              </li>
            ))}
            {recent.data?.length === 0 && <li className="py-2 text-muted">Sin movimientos.</li>}
          </ul>
        </Section>
        <Footnote>{MIXED_UNITS_NOTE}</Footnote>
      </aside>
    </div>
  );
}

export default function Metrics() {
  const { can } = useApp();
  const [params] = useSearchParams();
  const tabs = ([['calls', 'Llamados'], ['stock', 'Inventario']] as const).filter(([t]) => can(t === 'calls' ? 'analytics.calls.read' : 'analytics.inventory.read'));
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'stock' || !can('analytics.calls.read') ? 'stock' : 'calls');
  const [range, setRange] = useState<RangePreset>('last_7_days');
  return (
    <Page
      id="metricas" title="Métricas"
      actions={<div className="flex flex-wrap items-center gap-3 md:ml-auto">
        {tabs.length > 1 && <Segmented label="Qué medir" options={tabs} value={tab} onChange={setTab} />}
        <Segmented label="Período" options={RANGE_OPTIONS} value={range as (typeof RANGE_OPTIONS)[number][0]} onChange={setRange} />
      </div>}
    >
      {tab === 'calls' ? <CallsOnPlan range={range} /> : <StockByProduct range={range} />}
    </Page>
  );
}
