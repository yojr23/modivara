import type { RangePreset } from '@modivara/analytics-contracts';
import { ChartColumn, Info } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Columns, Figure, InOutColumns, RankBars, SeqScale, seq } from './charts';
import {
  MOVEMENTS, PRODUCTS, RANGE_OPTIONS, TABLE_INFO, ZONES, avgDailyOut, balancesOf, fmtNum, fmtQty, fmtSeconds, fmtWhen,
  inventoryMetrics, productById, serviceCallMetrics, tableInfo, unitWord,
} from './demo-data';
import { ElementShape, SPACES, type Space } from './plan';
import { Bone, EmptyState, ErrorState, OfflineBanner, ProtoControls, ProtoShell, Segmented, useViewState } from './shell';

// [DISEÑO] F5-12 — métricas básicas (llamados e inventario). Versión elegida (PLAN-002): «Sobre el plano», con datos de demo de la
// forma de `ServiceCallMetrics`/`InventoryMetrics`. Rótulos fieles a lo medido: «hasta En atención» es un registro, no la llegada a la
// mesa. Las alternativas A (informe) y C (franjas horarias) descartadas se pueden recuperar del commit 9835a72.

type Tab = 'calls' | 'stock';
const TABS = [['calls', 'Llamados'], ['stock', 'Inventario']] as const;
const LEAD: Record<RangePreset, string> = { today: 'Hoy', yesterday: 'Ayer', last_7_days: 'En los últimos 7 días', last_30_days: 'En los últimos 30 días', custom: 'En el período' };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function useMetrics() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'stock' ? 'stock' : 'calls');
  const [range, setRange] = useState<RangePreset>('last_7_days');
  const view = useViewState([tab, range]);
  return { tab, setTab, range, setRange, view };
}
type M = ReturnType<typeof useMetrics>;

function Shell({ m, children }: { m: M; children: ReactNode }) {
  return (
    <ProtoShell
      module="metricas" title="Métricas"
      actions={<div className="flex flex-wrap items-center gap-3 md:ml-auto">
        <Segmented label="Qué medir" options={TABS} value={m.tab} onChange={m.setTab} />
        <Segmented label="Período" options={RANGE_OPTIONS} value={m.range as (typeof RANGE_OPTIONS)[number][0]} onChange={m.setRange} />
      </div>}
    >
      {m.view.state === 'offline' && <OfflineBanner since="hace 3 min" />}
      {children}
      <ProtoControls view={m.view} />
    </ProtoShell>
  );
}

/** Carga, error y vacío antes del contenido; el esqueleto imita la forma de lo que viene. */
function Gate({ m, children, bones }: { m: M; children: ReactNode; bones: ReactNode }) {
  if (m.view.state === 'loading') return <div aria-busy aria-label="Cargando métricas">{bones}</div>;
  if (m.view.state === 'error') return <ErrorState what="las métricas" onRetry={m.view.retry} />;
  if (m.view.state === 'empty') {
    return (
      <EmptyState
        Icon={ChartColumn} title={m.tab === 'calls' ? 'Sin llamados en este período' : 'Sin movimientos en este período'}
        text={m.tab === 'calls' ? 'Cuando las mesas pulsen su botón, aquí verás cuántos llamados hubo y cuánto tardó cada paso.' : 'Las entradas, salidas y ajustes que se registren en Inventario aparecen aquí.'}
        action={<Button variant="secondary" onClick={() => { m.view.setForced('ready'); m.setRange('last_30_days'); }}>Ver los últimos 30 días</Button>}
      />
    );
  }
  return <div className="anim-rise">{children}</div>;
}

const ChartBones = ({ h = 'h-44' }: { h?: string }) => (
  <div aria-hidden className="space-y-3"><Bone className="w-40" /><div className={cn('flex items-end gap-2', h)}>{[40, 65, 50, 80, 72, 95, 60, 45, 70, 85, 55, 30].map((v, i) => <Bone key={i} className="flex-1 rounded-b-none" style={{ height: `${v}%` }} />)}</div></div>
);
const FigureBones = ({ n = 4 }: { n?: number }) => (
  <div aria-hidden className="grid grid-cols-2 gap-6 md:grid-cols-4">{Array.from({ length: n }, (_, i) => <div key={i} className="space-y-2"><Bone className="w-24" /><Bone className="h-8 w-20" /><Bone className="w-32" /></div>)}</div>
);

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
const CALLS_NOTE = '«En atención» y «Atendida» son los momentos en que alguien del personal lo registró en el tablero; no miden la llegada a la mesa.';
const MIXED_UNITS_NOTE = 'Las cantidades se muestran por producto porque cada uno tiene su unidad (botellas, kg); para todo el local se cuentan movimientos.';

const periodData = (by: { bucket_label: string; calls: number }[]) => by.map((p) => ({ label: p.bucket_label, value: p.calls }));

/* ---------- Llamados sobre el plano ---------- */


/** El plano del editor teñido por llamados: área = color de un solo tono según su total; cada mesa lleva su número. */
function HeatPlan({ space, counts, selected, onSelect }: { space: Space; counts: Map<string, number>; selected: string | null; onSelect: (id: string | null) => void }) {
  const areaTotal = (id: string) => TABLE_INFO.filter((t) => t.zoneId === id).reduce((s, t) => s + (counts.get(t.id) ?? 0), 0);
  const maxArea = Math.max(1, ...(space.areas ?? []).map((a) => areaTotal(a.id)));
  return (
    <svg viewBox={`-24 -24 ${space.width + 48} ${space.height + 48}`} aria-label={`Llamados en ${space.name}`} className="block h-full w-full" onClick={() => onSelect(null)}>
      <rect x={-8} y={-8} width={space.width + 16} height={space.height + 16} rx={12} className="fill-surface" />
      {space.areas?.map((a) => {
        const n = areaTotal(a.id);
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
          <g key={e.id} role="button" tabIndex={0} aria-pressed={on} aria-label={`${tableInfo.get(e.table_id)!.label}: ${counts.get(e.table_id) ?? 0} llamados`} className="cursor-pointer outline-none"
            onClick={(ev) => { ev.stopPropagation(); onSelect(e.table_id); }} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onSelect(e.table_id))}>
            <ElementShape el={e} note={`${counts.get(e.table_id) ?? 0}`} />
            {on && <rect x={e.x - 8} y={e.y - 8} width={e.width + 16} height={e.height + 16} rx={12} fill="none" strokeWidth={3} className="stroke-focus" />}
          </g>
        );
      })}
    </svg>
  );
}

function CallsOnPlan({ m }: { m: M }) {
  const [spaceId, setSpaceId] = useState(SPACES[0]!.id);
  const [selected, setSelected] = useState<string | null>(null);
  const all = serviceCallMetrics({ range: m.range });
  const counts = new Map(all.by_table.map((r) => [r.table_id, r.calls]));
  const zone = ZONES.find((z) => z.id === selected);
  const table = selected ? tableInfo.get(selected) : undefined;
  const d = serviceCallMetrics({ range: m.range, zoneId: zone?.id, tableId: table?.id });
  const title = table ? table.label : zone ? zone.name : 'Todo el local';
  const where = table ? `${table.spaceName}${table.zoneName ? `, ${table.zoneName}` : ''}` : zone ? zone.spaceName : `${LEAD[m.range]}`;
  const space = SPACES.find((s) => s.id === spaceId)!;
  const maxArea = Math.max(1, ...ZONES.map((z) => all.by_zone.find((x) => x.zone_id === z.id)?.calls ?? 0));
  return (
    <div className="grid min-h-0 lg:h-[calc(100dvh-73px)] lg:grid-cols-[minmax(0,1fr)_380px]">
      <section aria-label="Plano con llamados" className="flex min-h-[420px] flex-col gap-3 bg-sunken p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Segmented label="Espacio" options={SPACES.map((s) => [s.id, s.name] as const)} value={spaceId} onChange={(id) => { setSpaceId(id); setSelected(null); }} />
          <SeqScale max={maxArea} unit="llamados por área" />
        </div>
        <div className="min-h-0 flex-1"><HeatPlan space={space} counts={counts} selected={selected} onSelect={setSelected} /></div>
        <p className="text-sm text-muted">Toca un área o una mesa para ver su detalle. El número de cada mesa es su total de llamados en el período.</p>
      </section>
      <aside aria-label={`Detalle de ${title}`} className="space-y-8 overflow-y-auto border-line bg-surface p-5 lg:border-l">
        <div key={selected ?? 'all'} className="anim-rise space-y-8">
          <div>
            <p className="text-sm text-muted">{where}</p>
            <h2 className="font-display text-3xl font-bold">{title}</h2>
            {selected && <Button size="sm" variant="ghost" className="-ml-3 mt-1" onClick={() => setSelected(null)}>Ver todo el local</Button>}
          </div>
          <div className="grid grid-cols-2 gap-6">
            <Figure label="Llamados" value={fmtNum(d.totals.calls)} />
            <Figure label="Mediana hasta «En atención»" value={fmtSeconds(d.time_to_acknowledge.median_seconds)} />
            <Figure label="Mediana hasta «Atendida»" value={fmtSeconds(d.time_to_complete.median_seconds)} />
            <Figure label="Con pulsaciones repetidas" value={`${pct(d.totals.calls_with_repeated_presses, d.totals.calls)} %`} />
          </div>
          <Section title={d.group_by === 'hour' ? 'Por hora' : 'Por día'}>
            <Columns data={periodData(d.by_period)} caption={`Llamados de ${title}`} unit={['llamado', 'llamados']} height={120} labelEvery={d.group_by === 'hour' ? 4 : d.by_period.length > 7 ? 5 : 1} current={m.range === 'yesterday' ? undefined : d.by_period.length - 1} />
          </Section>
          {!table && (
            <Section title="Mesas">
              <RankBars caption={`Mesas de ${title}`} selected={selected} onSelect={setSelected} rows={d.by_table.slice(0, 10).map((r) => ({ id: r.table_id, label: r.table_label, text: r.table_label, value: r.calls }))} />
            </Section>
          )}
          <Footnote>{CALLS_NOTE}</Footnote>
        </div>
      </aside>
    </div>
  );
}

function StockByProduct({ m }: { m: M }) {
  const [productId, setProductId] = useState(PRODUCTS[0]!.id);
  const all = PRODUCTS.map((p) => ({ p, outs: inventoryMetrics({ range: m.range, productId: p.id }).by_direction.find((x) => x.direction === 'out') }));
  const p = productById.get(productId)!;
  const d = inventoryMetrics({ range: m.range, productId });
  const balance = balancesOf(MOVEMENTS).get(productId) ?? 0;
  const recent = MOVEMENTS.filter((x) => x.product_id === productId).slice(0, 5);
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
      <section aria-label="Salidas por producto" className="p-4 md:p-6">
        <h2 className="mb-1 text-lg font-bold">Salidas por producto</h2>
        <p className="mb-4 text-sm text-muted">{LEAD[m.range]}, número de salidas registradas. Elige un producto para ver sus cantidades.</p>
        <RankBars caption="Salidas por producto" selected={productId} onSelect={setProductId}
          rows={all.sort((a, b) => (b.outs?.movement_count ?? 0) - (a.outs?.movement_count ?? 0)).map(({ p: x, outs }) => ({ id: x.id, label: x.name, text: x.name, value: outs?.movement_count ?? 0 }))} />
      </section>
      <aside key={productId} aria-label={`Detalle de ${p.name}`} className="anim-rise space-y-8 border-line bg-surface p-5 lg:min-h-[calc(100dvh-73px)] lg:border-l">
        <div>
          <p className="text-sm text-muted">{p.category}</p>
          <h2 className="font-display text-3xl font-bold">{p.name}</h2>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Figure label="Saldo actual" value={fmtQty(balance, p.unit)} />
          <Figure label="Salidas por día" value={fmtQty(Math.round(avgDailyOut(MOVEMENTS, productId) * 10) / 10, p.unit)} context="Promedio de 7 días" />
        </div>
        <Section title="Entradas y salidas" aside={`En ${unitWord(p.unit, 2)}`}>
          <InOutColumns data={d.by_period.map((b) => ({ label: b.bucket_label, in: Number(b.in_delta) + Math.max(0, Number(b.adjust_delta)), out: Number(b.out_delta) + Math.min(0, Number(b.adjust_delta)) }))} caption={`Entradas y salidas de ${p.name}`} height={130} labelEvery={d.by_period.length > 7 ? 4 : 1} />
        </Section>
        <Section title="Últimos movimientos">
          <ul className="divide-y divide-line text-sm">
            {recent.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                <span>{x.direction === 'in' ? 'Entrada' : x.direction === 'out' ? 'Salida' : 'Ajuste'}<span className="block text-xs text-muted">{fmtWhen(x.occurred_at)}</span></span>
                <span className="font-semibold tabular-nums">{Number(x.delta) > 0 ? '+' : '−'}{fmtQty(Math.abs(Number(x.delta)), p.unit)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Footnote>{MIXED_UNITS_NOTE}</Footnote>
      </aside>
    </div>
  );
}

export default function Metrics() {
  const m = useMetrics();
  return (
    <Shell m={m}>
      <Gate m={m} bones={<div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]"><Bone className="h-[60dvh] rounded-xl" /><div className="space-y-6 p-2"><FigureBones n={4} /><ChartBones h="h-28" /></div></div>}>
        {m.tab === 'calls' ? <CallsOnPlan m={m} /> : <StockByProduct m={m} />}
      </Gate>
    </Shell>
  );
}
