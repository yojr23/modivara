import type { LayoutElement } from '@modivara/hospitality-contracts';
import { cn } from '@/ui/cn';

// [DISEÑO] Prototipo de L-05/L-06 con datos locales: no llama a la API. Formas y tipos = contratos reales (ADR-003 §17).

/**
 * [DISEÑO] Espacio = piso o sector físico con su propio plano (Primer piso, Segundo piso). Área = zona dentro de ese plano
 * (`hospitality.zones`: Barra, Zona A, Terraza…). Ni el espacio-piso ni el tipo `area` existen aún en el contrato: es la
 * propuesta para que cada mesa tenga área según dónde está y las métricas (que ya filtran por `zone_id`) salgan por área.
 */
export type Area = { id: string; name: string; x: number; y: number; width: number; height: number; color: number };
export type Space = { id: string; name: string; width: number; height: number; elements: LayoutElement[]; areas?: Area[] };
/** `hasButton` = DeviceStatusDto.tables[].has_button; nunca ids ni claves del hardware. */
export type Table = { id: string; label: string; spaceId: string; hasButton: boolean };

const id = () => crypto.randomUUID();
const table = (label: string, spaceId: string): Table => ({ id: id(), label, spaceId, hasButton: label !== 'Mesa 10' && label !== 'Mesa 12' });

export const SALON = 'salon';
export const TERRAZA = 'terraza';

export const TABLES: Table[] = [
  ...Array.from({ length: 12 }, (_, i) => table(`Mesa ${i + 1}`, SALON)),
  ...Array.from({ length: 5 }, (_, i) => table(`Mesa ${i + 13}`, TERRAZA)),
];

const at = (t: Table, shape: 'round' | 'square' | 'rect', x: number, y: number, w = 70, h = w, rotation = 0): LayoutElement => ({
  id: id(), type: 'table', table_id: t.id, shape, x, y, width: w, height: h, rotation,
});
const box = (type: 'wall' | 'door' | 'bar', x: number, y: number, width: number, height: number): LayoutElement => ({ id: id(), type, x, y, width, height, rotation: 0 });
const text = (t: string, x: number, y: number, rotation = 0): LayoutElement => ({ id: id(), type: 'label', text: t, x, y, rotation });

const [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10] = TABLES;
const [m13, m14, m15, m16, m17] = TABLES.slice(12);

// Escena coherente: perímetro cerrado con entrada y escalera, cada área dentro del perímetro sin pisar muros,
// la barra (mostrador) dentro del área «Barra» y los rótulos de área sin encimarse con mesas.
// Mesas 11 y 12 quedan fuera a propósito: aparecen en «Mesas sin ubicar».
export const SPACES: Space[] = [
  {
    id: SALON, name: 'Primer piso', width: 1000, height: 640,
    areas: [
      { id: id(), name: 'Barra', x: 50, y: 50, width: 600, height: 220, color: 0 },
      { id: id(), name: 'Zona A', x: 50, y: 290, width: 600, height: 280, color: 1 },
      { id: id(), name: 'Zona B', x: 680, y: 120, width: 260, height: 450, color: 2 },
    ],
    elements: [
      box('wall', 20, 20, 960, 14), box('wall', 20, 20, 14, 600), box('wall', 966, 20, 14, 600),
      box('wall', 20, 606, 130, 14), box('door', 150, 606, 100, 14), box('wall', 250, 606, 730, 14),
      text('Entrada', 160, 594),
      text('Escalera al segundo piso', 700, 80),
      text('Ventanas', 946, 250, 90),
      box('bar', 110, 92, 480, 50),
      at(m1!, 'round', 120, 180), at(m2!, 'round', 260, 180), at(m3!, 'round', 400, 180), at(m4!, 'round', 540, 180),
      at(m5!, 'square', 120, 340), at(m6!, 'square', 260, 340), at(m7!, 'rect', 400, 340, 140, 70),
      at(m10!, 'round', 270, 460, 90),
      at(m8!, 'rect', 770, 170, 70, 130), at(m9!, 'rect', 770, 380, 70, 130),
    ],
  },
  {
    id: TERRAZA, name: 'Segundo piso', width: 800, height: 500,
    areas: [
      { id: id(), name: 'Zona VIP', x: 50, y: 50, width: 230, height: 390, color: 1 },
      { id: id(), name: 'Terraza', x: 340, y: 50, width: 410, height: 400, color: 0 },
    ],
    elements: [
      box('wall', 20, 20, 760, 14), box('wall', 20, 20, 14, 460), box('wall', 766, 20, 14, 460),
      box('wall', 20, 466, 30, 14), box('door', 50, 466, 100, 14), box('wall', 150, 466, 630, 14),
      box('wall', 300, 20, 14, 170), box('door', 300, 190, 14, 100), box('wall', 300, 290, 14, 190),
      text('Escalera', 60, 456),
      text('Jardinera', 600, 430),
      at(m16!, 'square', 120, 120), at(m17!, 'rect', 90, 280, 150, 70),
      at(m13!, 'round', 390, 120), at(m14!, 'round', 560, 120), at(m15!, 'round', 470, 290),
    ],
  },
];

export const tableById = new Map(TABLES.map((t) => [t.id, t]));

/**
 * Actividad inventada para el prototipo (llamados en 7 días y segundos promedio hasta «En atención» por mesa). En la app real sale
 * de las métricas de analytics por `zone_id`/`table_id` (GET …/metrics/service-calls), con el área que tenía la mesa al llamar.
 */
const CALLS_7D = [31, 24, 38, 27, 9, 7, 16, 14, 12, 6, 3, 0, 19, 22, 11, 8, 5];
const ACK_S = [48, 55, 62, 51, 95, 110, 80, 70, 76, 120, 90, 0, 66, 58, 88, 140, 150];
export const ACTIVITY = new Map(TABLES.map((t, i) => [t.id, { calls7d: CALLS_7D[i] ?? 0, ackSeconds: ACK_S[i] ?? 0 }]));
export const RANGES = [['today', 'Hoy', 1 / 7], ['7d', '7 días', 1], ['30d', '30 días', 30 / 7]] as const;

type Box = { x: number; y: number; width: number; height: number };
/** Área de una mesa = la que contiene su centro (la primera, si se solapan; el editor no deja publicar áreas solapadas). */
export const areaAt = (areas: Area[] | undefined, el: Box) =>
  areas?.find((a) => {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height;
  });

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

export function toneOf(status: 'pending' | 'in_progress' | undefined, waitedMs: number): Tone {
  if (!status) return 'idle';
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

/** Una figura del plano en coordenadas del lienzo; `x, y` = esquina superior izquierda, giro sobre el centro. */
export function ElementShape({ el, tone = 'idle', note, progress, warn }: { el: LayoutElement; tone?: Tone; note?: string; progress?: number; warn?: boolean }) {
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
  const label = tableById.get(el.table_id)?.label ?? '?';
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
