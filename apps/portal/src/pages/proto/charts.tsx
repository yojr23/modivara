import type { ReactNode } from 'react';
import { cn } from '@/ui/cn';
import { fmtNum } from './demo-data';

// [DISEÑO] Gráficos a mano (PLAN-002, Q4): columnas ≤ 24 px con punta redondeada, cuadrícula de 1 px, tooltip al pasar o enfocar,
// tabla oculta para lectores de pantalla. Magnitud en un solo tono (`interface`); entradas/salidas con la paleta validada.

/** Tope «redondo» del eje: 1, 2 o 5 × 10ⁿ. */
export function niceMax(n: number) {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p;
}

/** Paso de la escala secuencial (0 = sin datos) como mezcla de `interface` sobre la superficie. */
export const seq = (t: number) => (t <= 0 ? 'var(--sunken)' : `color-mix(in srgb, var(--color-interface) ${Math.round(14 + 76 * Math.min(1, t))}%, var(--surface))`);

/** Cubeta en curso: trama a 135° del mismo tono (dato incompleto, no una caída). */
const HATCH = 'repeating-linear-gradient(135deg, var(--color-interface) 0 3px, color-mix(in srgb, var(--color-interface) 40%, var(--surface)) 3px 6px)';

function Tip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span role="tooltip" className={cn('pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-md bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-warm shadow-lg group-hover:block group-focus-visible:block', className)}>
      {children}
    </span>
  );
}

function SrTable({ caption, head, rows }: { caption: string; head: [string, string]; rows: [string, string][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr><th>{head[0]}</th><th>{head[1]}</th></tr></thead>
      <tbody>{rows.map(([a, b], i) => <tr key={i}><td>{a}</td><td>{b}</td></tr>)}</tbody>
    </table>
  );
}

/**
 * Columnas de una sola serie (llamados por día u hora). `labelEvery` raleará las etiquetas del eje x; `current` marca la cubeta
 * en curso (incompleta) con una trama, para que no se lea como una caída.
 */
export function Columns({ data, caption, unit, height = 180, labelEvery = 1, current }: {
  data: { label: string; value: number }[]; caption: string; unit: [string, string]; height?: number; labelEvery?: number; current?: number;
}) {
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const ticks = [max, max / 2, 0];
  return (
    <figure className="relative">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div aria-hidden className="relative text-right text-xs text-muted tabular-nums" style={{ height }}>
          {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / max) * 100}%` }}>{fmtNum(t)}</span>)}
        </div>
        <div className="relative" style={{ height }}>
          {ticks.map((t) => <div key={t} aria-hidden className="absolute inset-x-0 border-t border-line" style={{ top: `${(1 - t / max) * 100}%` }} />)}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => (
              <div key={i} tabIndex={0} aria-label={`${d.label}: ${d.value} ${d.value === 1 ? unit[0] : unit[1]}`} className="group relative flex h-full min-w-0 flex-1 items-end justify-center outline-none">
                <div
                  className="w-full max-w-6 rounded-t-[4px] bg-interface transition-[height] duration-300 group-hover:brightness-90"
                  style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0, ...(i === current && { background: HATCH }) }}
                />
                <Tip><span className="font-semibold tabular-nums">{d.value}</span> {d.value === 1 ? unit[0] : unit[1]}<span className="block text-warm/70">{d.label}{i === current ? ', en curso' : ''}</span></Tip>
              </div>
            ))}
          </div>
        </div>
        <span />
        <div aria-hidden className="mt-1.5 flex gap-[2px] text-xs text-muted">
          {data.map((d, i) => <span key={i} className="min-w-0 flex-1 truncate text-center">{i % labelEvery === 0 ? d.label : ''}</span>)}
        </div>
      </div>
      <SrTable caption={caption} head={['Período', unit[1]]} rows={data.map((d) => [d.label, String(d.value)])} />
    </figure>
  );
}

/** Ranking horizontal: etiqueta, barra y valor en la punta. Se ordena afuera. */
export function RankBars({ rows, caption, max: maxIn, onSelect, selected }: {
  rows: { id: string; label: ReactNode; text: string; value: number; hint?: string }[]; caption: string; max?: number; onSelect?: (id: string) => void; selected?: string | null;
}) {
  const max = maxIn ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol aria-label={caption} className="space-y-1">
      {rows.map((r) => {
        const body = (
          <>
            <span className="w-36 shrink-0 truncate text-left text-sm">{r.label}</span>
            <span className="relative h-5 flex-1">
              <span className="absolute inset-y-0.5 left-0 rounded-r-[4px] bg-interface transition-[width] duration-300" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
            </span>
            <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">{fmtNum(r.value)}</span>
          </>
        );
        return (
          <li key={r.id} title={r.hint}>
            {onSelect ? (
              <button type="button" aria-pressed={selected === r.id} aria-label={`${r.text}: ${r.value}`} onClick={() => onSelect(r.id)} className={cn('flex w-full items-center gap-3 rounded-md px-2 py-1 hover:bg-sunken', selected === r.id && 'bg-sunken ring-1 ring-line-strong')}>
                {body}
              </button>
            ) : <div className="flex items-center gap-3 px-2 py-1">{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Entradas hacia arriba y salidas hacia abajo de una línea base (polaridad); leyenda siempre visible. */
export function InOutColumns({ data, caption, height = 160, labelEvery = 1 }: {
  data: { label: string; in: number; out: number }[]; caption: string; height?: number; labelEvery?: number;
}) {
  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.in, -d.out])));
  return (
    <figure>
      <Legend items={[['in', 'Entradas'], ['out', 'Salidas']]} />
      <div className="relative mt-3" style={{ height }}>
        <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-line-strong" />
        <span aria-hidden className="absolute -top-1 left-0 text-xs text-muted tabular-nums">+{fmtNum(max)}</span>
        <span aria-hidden className="absolute -bottom-1 left-0 text-xs text-muted tabular-nums">−{fmtNum(max)}</span>
        <div className="absolute inset-0 ml-10 flex gap-[2px]">
          {data.map((d, i) => (
            <div key={i} tabIndex={0} aria-label={`${d.label}: entradas ${fmtNum(d.in)}, salidas ${fmtNum(-d.out)}`} className="group relative flex min-w-0 flex-1 flex-col items-center outline-none">
              <div className="flex h-1/2 w-full items-end justify-center pb-px">
                <div className="w-full max-w-6 rounded-t-[4px] bg-series-in group-hover:brightness-90" style={{ height: `${(d.in / max) * 100}%` }} />
              </div>
              <div className="flex h-1/2 w-full items-start justify-center pt-px">
                <div className="w-full max-w-6 rounded-b-[4px] bg-series-out group-hover:brightness-90" style={{ height: `${(-d.out / max) * 100}%` }} />
              </div>
              <Tip className="bottom-1/2"><span className="block font-semibold">{d.label}</span>Entradas {fmtNum(d.in)}<br />Salidas {fmtNum(-d.out)}</Tip>
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="mt-1.5 ml-10 flex gap-[2px] text-xs text-muted">
        {data.map((d, i) => <span key={i} className="min-w-0 flex-1 truncate text-center">{i % labelEvery === 0 ? d.label : ''}</span>)}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Período</th><th>Entradas</th><th>Salidas</th></tr></thead>
        <tbody>{data.map((d, i) => <tr key={i}><td>{d.label}</td><td>{d.in}</td><td>{-d.out}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export function Legend({ items }: { items: (readonly ['in' | 'out' | 'seq', string])[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {items.map(([k, label]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('size-3 rounded-[3px]', { in: 'bg-series-in', out: 'bg-series-out', seq: 'bg-interface' }[k])} />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** Escala secuencial para mapas de calor: de «menos» a «más» con los mismos pasos que las celdas. */
export function SeqScale({ max, unit }: { max: number; unit: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span>0</span>
      <span aria-hidden className="flex gap-[2px]">{[0, 0.25, 0.5, 0.75, 1].map((t) => <span key={t} className="h-3 w-6 rounded-[3px]" style={{ background: seq(t) }} />)}</span>
      <span className="tabular-nums">{fmtNum(max)} {unit}</span>
    </div>
  );
}

/** Mapa de calor filas × columnas (días × horas). Celdas de 2 px de separación; el valor va en el tooltip y en la tabla. */
export function Heatmap({ rows, cols, value, caption, rowLabel, colLabel, unit }: {
  rows: string[]; cols: string[]; value: (r: number, c: number) => number; caption: string; rowLabel: (r: number) => string; colLabel: (c: number) => string; unit: [string, string];
}) {
  const max = Math.max(1, ...rows.flatMap((_, r) => cols.map((__, c) => value(r, c))));
  return (
    <figure className="overflow-x-auto">
      <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: `5.5rem repeat(${cols.length}, minmax(0, 1fr))` }}>
        <span />
        {cols.map((c, i) => <span key={i} aria-hidden className="pb-1 text-center text-xs text-muted">{c}</span>)}
        {rows.map((r, ri) => (
          <div key={ri} className="contents">
            <span className="pr-2 text-right text-xs leading-7 text-muted">{r}</span>
            {cols.map((_, ci) => {
              const v = value(ri, ci);
              return (
                <span key={ci} tabIndex={0} aria-label={`${rowLabel(ri)}, ${colLabel(ci)}: ${v} ${v === 1 ? unit[0] : unit[1]}`} className="group relative h-7 rounded-[4px] outline-none hover:ring-2 hover:ring-ink focus-visible:ring-2 focus-visible:ring-focus" style={{ background: seq(v / max) }}>
                  <Tip><span className="font-semibold tabular-nums">{v}</span> {v === 1 ? unit[0] : unit[1]}<span className="block text-warm/70">{rowLabel(ri)}, {colLabel(ci)}</span></Tip>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3"><SeqScale max={max} unit={unit[1]} /></div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>{rows.map((r, ri) => <tr key={ri}><th>{r}</th>{cols.map((c, ci) => <td key={ci}>{c}: {value(ri, ci)}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Tendencia mínima: línea de 2 px y punto final; el último valor lo dice el texto de al lado, no el gráfico. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label: string }) {
  const w = 96;
  const h = 28;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * (w - 6) + 3, h - 3 - (v / max) * (h - 6)] as const);
  const last = pts.at(-1)!;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${h}`} className={cn('h-7 w-24 overflow-visible', className)}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-line-strong" />
      <circle cx={last[0]} cy={last[1]} r={4} strokeWidth={2} className="fill-interface stroke-surface" />
    </svg>
  );
}

/** Cifra sobria: rótulo arriba, valor y una línea de contexto. Sin tarjeta pesada; la separación la da el espacio. */
export function Figure({ label, value, context, className }: { label: string; value: ReactNode; context?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold">{value}</p>
      {context && <p className="mt-1 text-sm text-muted">{context}</p>}
    </div>
  );
}
