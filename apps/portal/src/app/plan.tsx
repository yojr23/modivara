import type { LayoutElement } from '@modivara/hospitality-contracts';
import { cn } from '@/ui/cn';

/**
 * Planos (ADR-003, decisión del 30/10/2026 en PLAN-002): espacio = piso o sector = zona de hospitality con su propio plano
 * (`zone_id` null = «Salón principal», el espacio único del local). Área = elemento `area` dibujado dentro del plano; una mesa
 * pertenece al área que contiene su centro. Las métricas por área se calculan sumando las mesas de cada área.
 */

export type PlanElement = Exclude<LayoutElement, { type: 'area' }>;
export type Area = { id: string; name: string; x: number; y: number; width: number; height: number; color: number };
export type Space = { id: string; zoneId: string | null; name: string; width: number; height: number; elements: PlanElement[]; areas: Area[] };
/** `hasButton` = DeviceStatusDto.tables[].has_button; nunca ids ni claves del hardware. */
export type Table = { id: string; label: string; spaceId: string; hasButton: boolean };

export const DEFAULT_SPACE = 'default';
export const DEFAULT_SPACE_NAME = 'Salón principal';
export const spaceIdOf = (zoneId: string | null) => zoneId ?? DEFAULT_SPACE;

/** Separa las áreas del resto de elementos; el color de cada área sale de su orden en el plano. */
export function splitAreas(all: LayoutElement[]): { areas: Area[]; elements: PlanElement[] } {
  const areas: Area[] = [];
  const elements: PlanElement[] = [];
  for (const e of all) {
    if (e.type === 'area') areas.push({ id: e.id, name: e.name, x: e.x, y: e.y, width: e.width, height: e.height, color: areas.length % AREA_STYLE.length });
    else elements.push(e);
  }
  return { areas, elements };
}

/** Inverso de `splitAreas`: las áreas van primero (se dibujan debajo de todo). */
export const joinAreas = (areas: Area[], elements: PlanElement[]): LayoutElement[] => [
  ...areas.map((a): LayoutElement => ({ id: a.id, type: 'area', name: a.name.trim(), x: a.x, y: a.y, width: a.width, height: a.height, rotation: 0 })),
  ...elements,
];

type Box = { x: number; y: number; width: number; height: number };
/** Área de una mesa = la que contiene su centro (la primera, si se solapan; el editor no deja publicar áreas solapadas). */
export const areaAt = (areas: Area[] | undefined, el: Box) =>
  areas?.find((a) => {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height;
  });

/** Suma por área de un valor por mesa (llamados); las mesas fuera de toda área no cuentan. */
export function areaTotals(areas: Area[], elements: PlanElement[], valueOf: (tableId: string) => number): Map<string, number> {
  const totals = new Map(areas.map((a) => [a.id, 0]));
  for (const e of elements) {
    if (e.type !== 'table') continue;
    const a = areaAt(areas, e);
    if (a) totals.set(a.id, totals.get(a.id)! + valueOf(e.table_id));
  }
  return totals;
}

// Colores derivados de la marca; el nombre del área siempre va escrito, el color solo ayuda.
export const AREA_STYLE = [
  { box: 'fill-connect/8 stroke-connect', text: 'fill-done-fg', swatch: 'bg-connect' },
  { box: 'fill-interface/8 stroke-interface', text: 'fill-interface', swatch: 'bg-interface' },
  { box: 'fill-line-strong/10 stroke-line-strong', text: 'fill-muted', swatch: 'bg-line-strong' },
] as const;

// ponytail: asume etiquetas «Mesa N» (seed); otra etiqueta se muestra completa.
export const shortLabel = (label: string) => label.replace(/^Mesa\s+/i, '');

export type Tone = 'idle' | 'new' | 'waiting' | 'late' | 'attending';

/** Umbrales visuales de ADR-003 ESP-24 (no son SLO). */
export const AMBER_MS = 2 * 60_000;
export const RED_MS = 5 * 60_000;

export function toneOf(status: 'pending' | 'in_progress' | 'completed' | undefined, waitedMs: number): Tone {
  if (!status || status === 'completed') return 'idle';
  if (status === 'in_progress') return 'attending';
  return waitedMs >= RED_MS ? 'late' : waitedMs >= AMBER_MS ? 'waiting' : 'new';
}

const TABLE_TONE: Record<Tone, string> = {
  idle: 'fill-surface stroke-line-strong',
  new: 'fill-surface stroke-pending',
  waiting: 'fill-pending stroke-pending',
  late: 'fill-danger stroke-danger',
  attending: 'fill-surface stroke-attending',
};
const TEXT_TONE: Record<Tone, string> = {
  idle: 'fill-muted', new: 'fill-fg', waiting: 'fill-pending-fg', late: 'fill-danger-fg', attending: 'fill-fg',
};

/** Una figura del plano en coordenadas del lienzo; `x, y` = esquina superior izquierda, giro sobre el centro. `label` = nombre de la mesa. */
export function ElementShape({ el, label = '?', tone = 'idle', note, progress, warn }: { el: PlanElement; label?: string; tone?: Tone; note?: string; progress?: number; warn?: boolean }) {
  if (el.type === 'label') {
    return <text x={el.x} y={el.y} transform={`rotate(${el.rotation} ${el.x} ${el.y})`} className="fill-muted text-[18px] font-medium">{el.text}</text>;
  }
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const warnCls = warn && 'stroke-pending [stroke-dasharray:6_4]';
  if (el.type !== 'table') {
    const cls = { wall: 'fill-line-strong stroke-line-strong', door: 'fill-bg stroke-line-strong [stroke-dasharray:5_4]', bar: 'fill-sunken stroke-line-strong' }[el.type];
    return (
      <g transform={`rotate(${el.rotation} ${cx} ${cy})`}>
        <rect x={el.x} y={el.y} width={el.width} height={el.height} rx={el.type === 'bar' ? 10 : 2} strokeWidth={2} className={cn(cls, warnCls)} />
        {el.type === 'bar' && <text x={cx} y={cy} dominantBaseline="central" textAnchor="middle" className="fill-muted text-[18px] font-semibold">Barra</text>}
      </g>
    );
  }
  const heavy = tone !== 'idle';
  const r = Math.max(el.width, el.height) / 2 + 12;
  // Anillo de espera: se completa al llegar al umbral rojo. Informa la antigüedad, no anima por sí solo.
  const ring = progress !== undefined && (
    <>
      <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={6} className="stroke-line" />
      <circle
        cx={cx} cy={cy} r={r} fill="none" strokeWidth={6} strokeLinecap="round" pathLength={1}
        strokeDasharray={`${Math.min(progress, 1)} 1`} transform={`rotate(-90 ${cx} ${cy})`}
        className={tone === 'late' ? 'stroke-danger' : 'stroke-pending'}
      />
    </>
  );
  return (
    <g>
      {ring}
      <g transform={`rotate(${el.rotation} ${cx} ${cy})`}>
        {el.shape === 'round'
          ? <ellipse cx={cx} cy={cy} rx={el.width / 2} ry={el.height / 2} strokeWidth={heavy ? 4 : 2} className={cn(TABLE_TONE[tone], warnCls)} />
          : <rect x={el.x} y={el.y} width={el.width} height={el.height} rx={8} strokeWidth={heavy ? 4 : 2} className={cn(TABLE_TONE[tone], warnCls)} />}
      </g>
      <text x={cx} y={note ? cy - 8 : cy} dominantBaseline="central" textAnchor="middle" className={cn('font-display text-[24px] font-extrabold tabular-nums', TEXT_TONE[tone])}>
        {shortLabel(label)}
      </text>
      {note && <text x={cx} y={cy + 16} dominantBaseline="central" textAnchor="middle" className={cn('text-[13px] font-semibold tabular-nums', TEXT_TONE[tone])}>{note}</text>}
    </g>
  );
}
