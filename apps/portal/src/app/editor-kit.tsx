import { LAYOUT_LABEL_MAX, type LayoutDto } from '@modivara/hospitality-contracts';
import {
  layoutErrorState, useCreateTable, useCreateZone, useDeviceStatus, useLayoutDraft, usePublishLayout, useSaveLayoutDraft, useTables, useUpdateTable, useUpdateZone, useZones,
} from '@modivara/hospitality-web';
import { Circle, DoorOpen, GlassWater, Minus, MousePointer2, RotateCw, Trash, Type, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { AREA_STYLE, DEFAULT_SPACE, DEFAULT_SPACE_NAME, ElementShape, areaAt, joinAreas, spaceIdOf, splitAreas, type Area, type PlanElement, type Space, type Table } from './plan';
import { useApp } from './ui';

// Estado y piezas del editor de espacios (L-05). Espacio = zona (piso o sector) con su plano; «Salón principal» = zona null.
// Guardar y publicar van a la API con concurrencia optimista (`revision`, 409 con el borrador vigente).

export const GRID = 20;
type Sized = Exclude<PlanElement, { type: 'label' }>;
export const sized = (el: PlanElement): el is Sized => el.type !== 'label';
const clone = (s: Space): Space => ({ ...s, elements: s.elements.map((e) => ({ ...e })), areas: s.areas.map((a) => ({ ...a })) });
const same = (a: Space | null, b: Space | null) => JSON.stringify(a) === JSON.stringify(b);

export const KIND: Record<PlanElement['type'], string> = { table: 'Mesa', wall: 'Pared', door: 'Puerta', bar: 'Barra', label: 'Etiqueta' };
const SHAPES = [['round', 'Redonda'], ['square', 'Cuadrada'], ['rect', 'Rectangular']] as const;

export type ToolId = 'select' | 'table' | 'wall' | 'door' | 'bar' | 'label';
export const TOOLS: { id: ToolId; label: string; Icon: LucideIcon }[] = [
  { id: 'select', label: 'Seleccionar', Icon: MousePointer2 },
  { id: 'table', label: 'Mesa', Icon: Circle },
  { id: 'wall', label: 'Pared', Icon: Minus },
  { id: 'door', label: 'Puerta', Icon: DoorOpen },
  { id: 'bar', label: 'Barra', Icon: GlassWater },
  { id: 'label', label: 'Etiqueta', Icon: Type },
];

// ponytail: superposición por cajas sin girar; basta para avisar (E-07 no bloquea). Con giros reales, usar SAT.
function overlaps(els: PlanElement[]): Set<string> {
  const boxes = els.filter(sized).filter((e) => e.type !== 'door');
  const hit = new Set<string>();
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      if ((a.type === 'table' || b.type === 'table') && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
        hit.add(a.id);
        hit.add(b.id);
      }
  return hit;
}

/** Lienzo de un espacio sin plano todavía. */
const NEW_CANVAS = { width: 1000, height: 640 };
const toSpace = (meta: { id: string; zoneId: string | null; name: string }, layout: LayoutDto | null): Space =>
  ({ ...meta, width: layout?.canvas_width ?? NEW_CANVAS.width, height: layout?.canvas_height ?? NEW_CANVAS.height, ...splitAreas(layout?.elements ?? []) });

export function useLayoutEditor() {
  const { location } = useApp();
  const l = location.id;
  const zonesQ = useZones(l);
  const tablesQ = useTables(l);
  const devicesQ = useDeviceStatus(l);
  const createZone = useCreateZone(l);
  const updateZone = useUpdateZone(l);
  const createTableM = useCreateTable(l);
  const updateTableM = useUpdateTable(l);
  const saveM = useSaveLayoutDraft(l);
  const publishM = usePublishLayout(l);

  // Espacios: «Salón principal» si el local no tiene zonas o tiene mesas sin zona (E-01), más una entrada por zona.
  const zones = [...(zonesQ.data ?? [])].sort((a, b) => a.position - b.position);
  const hasDefault = zones.length === 0 || (tablesQ.data ?? []).some((t) => t.zone_id === null);
  const spaceList: { id: string; zoneId: string | null; name: string }[] = [
    ...(hasDefault ? [{ id: DEFAULT_SPACE, zoneId: null, name: DEFAULT_SPACE_NAME }] : []),
    ...zones.map((z) => ({ id: z.id, zoneId: z.id, name: z.name })),
  ];
  const [chosen, setChosen] = useState<string | null>(null);
  const meta = spaceList.find((s) => s.id === chosen) ?? spaceList[0] ?? { id: DEFAULT_SPACE, zoneId: null, name: DEFAULT_SPACE_NAME };
  const spaceId = meta.id;
  const draftQ = useLayoutDraft(l, meta.zoneId);

  const [work, setWork] = useState<Space | null>(null);
  const [base, setBase] = useState<Space | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState('');
  const [pendingSpace, setPendingSpace] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [conflict, setConflict] = useState<LayoutDto | null | false>(false);

  // Al cargar (o recargar) el borrador del espacio, lo guardado pasa a ser la base; lo que se edita solo se reemplaza si no tiene cambios.
  const loaded = draftQ.data;
  useEffect(() => {
    if (!loaded) return;
    const next = toSpace(meta, loaded.draft ?? loaded.published);
    setBase(next);
    setRevision(loaded.draft?.revision ?? 0);
    setWork((w) => (!w || w.id !== next.id || same(w, base) ? clone(next) : w));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, spaceId, meta.name]);

  const space = work && work.id === spaceId ? work : toSpace(meta, null);
  const dirty = !!work && !!base && work.id === base.id && !same(work, base);
  const tables: Table[] = (tablesQ.data ?? []).map((t) => ({
    id: t.id, label: t.label, spaceId: spaceIdOf(t.zone_id), hasButton: devicesQ.data?.tables.find((x) => x.table_id === t.id)?.has_button ?? false,
  }));
  const tableLabel = new Map(tables.map((t) => [t.id, t.label]));
  const el = space.elements.find((e) => e.id === selected);
  const hits = useMemo(() => overlaps(space.elements), [space.elements]);
  const placed = new Set(space.elements.flatMap((e) => (e.type === 'table' ? [e.table_id] : [])));
  const unplaced = tables.filter((t) => t.spaceId === spaceId && !placed.has(t.id));
  const outside = space.elements.filter(sized).filter((e) => e.x + e.width > space.width || e.y + e.height > space.height);
  const areas = space.areas;
  const area = areas.find((a) => a.id === selected);
  const placedTables = space.elements.filter((e) => e.type === 'table');
  const areaOf = (e: PlanElement) => (sized(e) ? areaAt(areas, e) : undefined);
  const tablesIn = (a: Area | undefined) => placedTables.filter((e) => areaOf(e)?.id === a?.id).map((e) => tableLabel.get(e.table_id) ?? 'Mesa');
  const withoutArea = areas.length ? tablesIn(undefined) : [];
  const areaOverlap = areas.some((a, i) => areas.slice(i + 1).some((b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));
  // Área de cada mesa en el plano publicado, para mostrar en la revisión qué mesas cambian de área.
  const publishedNow = loaded?.published ? splitAreas(loaded.published.elements) : null;
  const publishedArea = new Map(publishedNow ? publishedNow.elements.flatMap((e) => (e.type === 'table' ? [[e.table_id, areaAt(publishedNow.areas, e)?.name ?? null] as const] : [])) : []);
  const areaChanges = publishedNow ? placedTables.flatMap((e) => {
    const before = publishedArea.get(e.table_id) ?? null;
    const after = areaOf(e)?.name ?? null;
    return before === after ? [] : [{ label: tableLabel.get(e.table_id) ?? 'Mesa', before, after }];
  }) : [];

  const edit = (fn: (s: Space) => Space) => setWork((w) => fn(w && w.id === spaceId ? w : clone(space)));
  const setElements = (fn: (els: PlanElement[]) => PlanElement[]) => edit((s) => ({ ...s, elements: fn(s.elements) }));
  const update = (id: string, patch: Record<string, unknown>) =>
    setElements((els) => els.map((e) => (e.id === id ? ({ ...e, ...patch } as PlanElement) : e)));
  const round = (v: number) => (snap ? Math.round(v / GRID) * GRID : Math.round(v));
  const moveTo = (e: PlanElement, x: number, y: number) =>
    update(e.id, {
      x: Math.min(Math.max(0, x), space.width - (sized(e) ? e.width : 0)),
      y: Math.min(Math.max(0, y), space.height - (sized(e) ? e.height : 0)),
    });

  function add(next: PlanElement) {
    setElements((els) => [...els, next]);
    setSelected(next.id);
  }
  const at = (w: number, h: number, point?: { x: number; y: number }) => ({
    x: Math.max(0, round((point?.x ?? space.width / 2) - w / 2)), y: Math.max(0, round((point?.y ?? space.height / 2) - h / 2)), rotation: 0,
  });
  function addTool(tool: Exclude<ToolId, 'select' | 'table'>, point?: { x: number; y: number }) {
    if (tool === 'label') return add({ id: crypto.randomUUID(), type: 'label', text: 'Etiqueta', ...at(0, 0, point) });
    const [width, height] = { wall: [200, 14], door: [100, 14], bar: [300, 56] }[tool];
    add({ id: crypto.randomUUID(), type: tool, width: width!, height: height!, ...at(width!, height!, point) });
  }
  const place = (t: { id: string }, point?: { x: number; y: number }) =>
    add({ id: crypto.randomUUID(), type: 'table', table_id: t.id, shape: 'round', width: 70, height: 70, ...at(70, 70, point) });

  function remove(id: string) {
    setElements((els) => els.filter((e) => e.id !== id));
    setSelected(null);
  }

  const setAreas = (fn: (a: Area[]) => Area[]) => edit((s) => ({ ...s, areas: fn(s.areas) }));
  const updateArea = (id: string, patch: Partial<Area>) => setAreas((all) => all.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const moveArea = (a: Area, x: number, y: number) =>
    updateArea(a.id, { x: Math.min(Math.max(0, x), space.width - a.width), y: Math.min(Math.max(0, y), space.height - a.height) });
  function addArea(point?: { x: number; y: number }) {
    const next: Area = { id: crypto.randomUUID(), name: `Área ${areas.length + 1}`, width: 300, height: 200, color: areas.length % AREA_STYLE.length, ...at(300, 200, point) };
    setAreas((all) => [...all, next]);
    setSelected(next.id);
  }
  function removeArea(id: string) {
    setAreas((all) => all.filter((a) => a.id !== id));
    setSelected(null);
  }

  const labelTaken = (label: string, except?: string) =>
    tables.some((t) => t.id !== except && t.spaceId === spaceId && t.label.toLowerCase() === label.trim().toLowerCase());

  /** POST /tables en la zona del espacio y la ubica en el centro del plano. */
  async function createTable(label: string): Promise<boolean> {
    if (!label.trim()) return setMessage('Escribe el nombre de la mesa.'), false;
    if (labelTaken(label)) return setMessage(`Ya existe «${label.trim()}» en ${space.name}. Usa otro nombre.`), false;
    try {
      const t = await createTableM.mutateAsync({ label: label.trim(), zone_id: meta.zoneId });
      place(t);
      setMessage(`${t.label} creada y ubicada en el centro del plano. Guarda el borrador para conservar dónde está.`);
      return true;
    } catch {
      setMessage('No se pudo crear la mesa. Revisa el nombre y vuelve a intentar.');
      return false;
    }
  }

  /** PATCH /tables/:id: cambia el nombre en todo el sistema, no solo en el dibujo. */
  const renameTable = (id: string, label: string) =>
    updateTableM.mutate({ tableId: id, input: { label } }, {
      onSuccess: () => setMessage(`Mesa renombrada a ${label}.`),
      onError: () => setMessage('No se pudo cambiar el nombre (¿ya existe otra mesa así en este espacio?).'),
    });

  /** Guarda el borrador; devuelve la revisión nueva o null si no se pudo. */
  async function save(): Promise<number | null> {
    try {
      const saved = await saveM.mutateAsync({ zone_id: meta.zoneId, revision, canvas_width: space.width, canvas_height: space.height, elements: joinAreas(space.areas, space.elements) });
      setRevision(saved.revision);
      setBase(clone(space));
      setMessage('Borrador guardado. El personal sigue viendo el plano publicado.');
      return saved.revision;
    } catch (e) {
      const s = layoutErrorState(e);
      if (s && 'current' in s) setConflict(s.current ?? null);
      else setMessage(s?.state === 'validation' ? 'El servidor rechazó el plano: revisa que todo esté dentro del lienzo y que las áreas tengan nombre.' : 'No se pudo guardar. Revisa la conexión y vuelve a intentar.');
      return null;
    }
  }

  function requestPublish() {
    if (areaOverlap) return setMessage('Hay áreas encimadas: cada mesa debe quedar en una sola área. Sepáralas antes de publicar.');
    const out = outside[0];
    if (out) {
      setSelected(out.id);
      return setMessage(`${KIND[out.type]} se sale del lienzo. Muévela dentro antes de publicar.`);
    }
    setConfirmPublish(true);
  }

  async function publish() {
    setConfirmPublish(false);
    const rev = dirty || revision === 0 ? await save() : revision;
    if (!rev) return;
    try {
      const p = await publishM.mutateAsync({ zone_id: meta.zoneId, revision: rev });
      setRevision(0);
      setMessage(`Plano publicado: versión ${p.version} de ${space.name}.`);
    } catch (e) {
      const s = layoutErrorState(e);
      if (s && 'current' in s) setConflict(s.current ?? null);
      else setMessage('No se pudo publicar. Revisa que las mesas del plano sigan activas en este espacio.');
    }
  }

  function discard() {
    if (base) setWork(clone(base));
    setSelected(null);
    setMessage('Cambios descartados. Volviste a lo último guardado.');
  }

  function switchTo(id: string) {
    setChosen(id);
    setWork(null);
    setSelected(null);
    setPendingSpace(null);
  }
  const selectSpace = (id: string) => (id !== spaceId && dirty ? setPendingSpace(id) : switchTo(id));

  async function resolvePending(choice: 'save' | 'discard' | 'stay') {
    if (choice === 'stay') return setPendingSpace(null);
    if (choice === 'save' && !(await save())) return setPendingSpace(null);
    switchTo(pendingSpace!);
  }

  /** «Recargar» adopta el borrador vigente; «Conservar» sigue con lo propio y el próximo guardado reemplaza el de la otra persona. */
  function resolveConflict(choice: 'reload' | 'keep') {
    const current = conflict || null;
    setConflict(false);
    if (choice === 'reload') {
      const next = toSpace(meta, current ?? loaded?.published ?? null);
      setBase(next);
      setWork(clone(next));
      setRevision(current ? current.revision : 0);
      setSelected(null);
      setMessage('Cargaste la versión vigente del borrador.');
    } else {
      setRevision(current ? current.revision : 0);
      setMessage('Tus cambios siguen en pantalla. Si guardas, reemplazan el borrador de la otra persona.');
    }
  }

  async function addSpace() {
    try {
      const z = await createZone.mutateAsync({ name: `Espacio ${zones.length + 1}` });
      switchTo(z.id);
      setMessage(`${z.name} creado. Cámbiale el nombre con el lápiz del título.`);
    } catch {
      setMessage('No se pudo crear el espacio.');
    }
  }
  /** Nombre del espacio = nombre de la zona (PATCH /zones/:id). «Salón principal» no es una zona y no se renombra. */
  function renameSpace(name: string) {
    if (!meta.zoneId || !name.trim() || name.trim() === meta.name) return;
    updateZone.mutate({ zoneId: meta.zoneId, input: { name: name.trim() } }, { onError: () => setMessage('No se pudo cambiar el nombre (¿ya hay otro espacio con ese nombre?).') });
  }

  const saving = saveM.isPending || publishM.isPending;
  const status = saving ? 'Guardando…' : dirty ? 'Cambios sin guardar' : revision ? `Borrador guardado (revisión ${revision})` : 'Sin borrador';
  const publishedVersion = loaded?.published?.version ?? 0;
  const publishedLine = publishedVersion ? `Publicado: versión ${publishedVersion}` : 'Sin publicar';

  return {
    spaces: spaceList, space, spaceId, zoneId: meta.zoneId, tables, tableLabel, el, selected, setSelected, hits, unplaced, outside, dirty, saving, snap, setSnap, zoom, setZoom,
    message, setMessage, status, publishedLine, revision, published: publishedVersion,
    loading: zonesQ.isPending || tablesQ.isPending || draftQ.isPending, error: zonesQ.isError || tablesQ.isError || draftQ.isError,
    retry: () => { void zonesQ.refetch(); void tablesQ.refetch(); void draftQ.refetch(); },
    pendingSpace, confirmPublish, setConfirmPublish, conflict: conflict !== false,
    update, moveTo, round, add, addTool, place, remove, createTable, renameTable, labelTaken, save, requestPublish, publish, discard,
    selectSpace, resolvePending, resolveConflict, addSpace, renameSpace,
    areas, area, areaOf, tablesIn, withoutArea, areaOverlap, areaChanges, updateArea, moveArea, addArea, removeArea,
  };
}
export type Ed = ReturnType<typeof useLayoutEditor>;

export const nameOf = (ed: Ed, e: PlanElement) => (e.type === 'table' ? ed.tableLabel.get(e.table_id) ?? 'Mesa' : e.type === 'label' ? `Etiqueta «${e.text}»` : KIND[e.type]);

type Drag = { mode: 'move' | 'resize' | 'rotate'; id: string; dx: number; dy: number; area: boolean };

/**
 * Lienzo SVG: arrastrar mueve, el tirador de la esquina cambia el tamaño, el de arriba gira; teclado como alternativa.
 * Ocupa el contenedor (que debe tener alto definido) y encaja el plano completo; el zoom lo agranda dentro de un contenedor con scroll.
 */
export function PlanCanvas({ ed, readOnly = false, heat, className }: { ed: Ed; readOnly?: boolean; heat?: (tableId: string) => number; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const { space, selected } = ed;
  // Con `heat` el plano muestra actividad: cada área se tiñe según sus llamados y cada mesa lleva su número.
  const areaTotal = (a: Area) => space.elements.reduce((s, e) => (heat && e.type === 'table' && ed.areaOf(e)?.id === a.id ? s + heat(e.table_id) : s), 0);
  const maxArea = Math.max(1, ...ed.areas.map(areaTotal));
  const toCanvas = (e: { clientX: number; clientY: number }) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());

  function start(e: PointerEvent, target: { id: string; x: number; y: number }, mode: Drag['mode'], area = false) {
    if (readOnly) return;
    e.stopPropagation();
    ed.setSelected(target.id);
    const p = toCanvas(e);
    drag.current = { mode, id: target.id, dx: p.x - target.x, dy: p.y - target.y, area };
    svg.current!.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (d?.area) {
      const a = ed.areas.find((x) => x.id === d.id);
      if (!a) return;
      const p = toCanvas(e);
      if (d.mode === 'move') return ed.moveArea(a, ed.round(p.x - d.dx), ed.round(p.y - d.dy));
      return ed.updateArea(a.id, {
        width: Math.max(60, Math.min(ed.round(p.x - a.x), space.width - a.x)),
        height: Math.max(60, Math.min(ed.round(p.y - a.y), space.height - a.y)),
      });
    }
    const t = d && space.elements.find((x) => x.id === d.id);
    if (!d || !t) return;
    const p = toCanvas(e);
    if (d.mode === 'move') return ed.moveTo(t, ed.round(p.x - d.dx), ed.round(p.y - d.dy));
    if (!sized(t)) return;
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    // ponytail: el tamaño se calcula sin deshacer el giro; con mesas giradas el tirador «se resbala». Proyectar al eje local si molesta.
    if (d.mode === 'resize') ed.update(t.id, { width: Math.max(20, ed.round(p.x - t.x)), height: Math.max(10, ed.round(p.y - t.y)) });
    else ed.update(t.id, { rotation: ((Math.round(((Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90) / 15) * 15) % 360 + 360) % 360 });
  }

  function onKey(e: KeyboardEvent, t: PlanElement) {
    const step = e.shiftKey ? 1 : GRID;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (delta) {
      e.preventDefault();
      ed.moveTo(t, t.x + delta[0]!, t.y + delta[1]!);
    } else if (e.key === 'r' || e.key === 'R') ed.update(t.id, { rotation: (t.rotation + 15) % 360 });
    else if (e.key === 'Delete' || e.key === 'Backspace') ed.remove(t.id);
    else if (e.key === 'Escape') ed.setSelected(null);
  }

  function onDrop(e: DragEvent) {
    const t = ed.tables.find((x) => x.id === e.dataTransfer.getData('text/table-id'));
    const tool = e.dataTransfer.getData('text/tool') as Exclude<ToolId, 'select' | 'table'> | 'area' | '';
    if (t) ed.place(t, toCanvas(e));
    else if (tool === 'area') ed.addArea(toCanvas(e));
    else if (tool) ed.addTool(tool, toCanvas(e));
  }

  return (
    <svg
      ref={svg} viewBox={`-8 -8 ${space.width + 16} ${space.height + 16}`} aria-label={`Plano de ${space.name}`}
      style={{ width: `${ed.zoom * 100}%`, height: `${ed.zoom * 100}%` }} className={cn('block', className)}
      onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerDown={() => ed.setSelected(null)}
      onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
    >
      <defs>
        <pattern id="grid-dots" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <circle cx={1} cy={1} r={1.2} className="fill-line-strong/50" />
        </pattern>
      </defs>
      <rect width={space.width} height={space.height} rx={8} strokeWidth={1.5} className="fill-surface stroke-line" />
      {!readOnly && <rect width={space.width} height={space.height} fill="url(#grid-dots)" />}
      {ed.areas.map((a) => {
        const on = a.id === selected && !readOnly;
        const style = AREA_STYLE[a.color % AREA_STYLE.length]!;
        return (
          <g
            key={a.id} tabIndex={readOnly ? -1 : 0} role="button" aria-pressed={on} aria-label={`Área ${a.name}. Flechas para mover, Suprimir para quitar.`}
            onPointerDown={(ev) => start(ev, a, 'move', true)} onFocus={() => !readOnly && ed.setSelected(a.id)}
            onKeyDown={(ev) => {
              const delta = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[ev.key];
              if (delta) { ev.preventDefault(); ed.moveArea(a, a.x + delta[0]!, a.y + delta[1]!); }
              else if (ev.key === 'Delete' || ev.key === 'Backspace') ed.removeArea(a.id);
            }}
            className={cn('outline-none', !readOnly && 'cursor-grab touch-none')}
          >
            {heat ? (
              <>
                <rect x={a.x} y={a.y} width={a.width} height={a.height} rx={14} strokeWidth={2} className="fill-interface stroke-interface" style={{ fillOpacity: 0.05 + (0.4 * areaTotal(a)) / maxArea }} />
                <text x={a.x + 14} y={a.y + 26} className="fill-fg text-[17px] font-bold">{a.name}</text>
                <text x={a.x + a.width - 14} y={a.y + 26} textAnchor="end" className="fill-fg text-[17px] font-bold tabular-nums">
                  {areaTotal(a)}<title>{`${areaTotal(a)} llamados`}</title>
                </text>
              </>
            ) : (
              <>
                <rect x={a.x} y={a.y} width={a.width} height={a.height} rx={14} strokeWidth={on ? 3 : 2} className={cn(style.box, !on && '[stroke-dasharray:10_6]', on && 'stroke-focus')} />
                <text x={a.x + 14} y={a.y + 26} className={cn('text-[17px] font-bold', style.text)}>{a.name}</text>
              </>
            )}
            {on && <rect x={a.x + a.width - 8} y={a.y + a.height - 8} width={16} height={16} rx={3} strokeWidth={2} className="cursor-nwse-resize fill-surface stroke-focus" onPointerDown={(ev) => start(ev, a, 'resize', true)} />}
          </g>
        );
      })}
      {space.elements.length === 0 && (
        <text x={space.width / 2} y={space.height / 2} textAnchor="middle" className="fill-muted text-[22px]">Añade o ubica la primera mesa</text>
      )}
      {space.elements.map((e) => {
        const on = e.id === selected && !readOnly;
        const cx = sized(e) ? e.x + e.width / 2 : e.x;
        const cy = sized(e) ? e.y + e.height / 2 : e.y;
        return (
          <g
            key={e.id} tabIndex={readOnly ? -1 : 0} role="button" aria-pressed={on}
            aria-label={`${nameOf(ed, e)}. Flechas para mover, R para girar, Suprimir para quitar.`}
            onPointerDown={(ev) => start(ev, e, 'move')} onKeyDown={(ev) => onKey(ev, e)} onFocus={() => !readOnly && ed.setSelected(e.id)}
            className={cn('outline-none', !readOnly && 'cursor-grab touch-none')}
          >
            <ElementShape el={e} label={e.type === 'table' ? ed.tableLabel.get(e.table_id) : undefined} warn={!readOnly && ed.hits.has(e.id)} note={heat && e.type === 'table' ? `${heat(e.table_id)}` : undefined} />
            {on && sized(e) && (
              <g transform={`rotate(${e.rotation} ${cx} ${cy})`}>
                <rect x={e.x - 6} y={e.y - 6} width={e.width + 12} height={e.height + 12} rx={8} fill="none" strokeWidth={2} className="stroke-focus" />
                <line x1={cx} y1={e.y - 6} x2={cx} y2={e.y - 30} strokeWidth={2} className="stroke-focus" />
                <circle cx={cx} cy={e.y - 36} r={8} strokeWidth={2} className="cursor-alias fill-surface stroke-focus" onPointerDown={(ev) => start(ev, e, 'rotate')} />
                <rect x={e.x + e.width - 2} y={e.y + e.height - 2} width={16} height={16} rx={3} strokeWidth={2} className="cursor-nwse-resize fill-surface stroke-focus" onPointerDown={(ev) => start(ev, e, 'resize')} />
              </g>
            )}
            {on && e.type === 'label' && <circle cx={e.x - 10} cy={e.y - 6} r={5} className="fill-focus" />}
          </g>
        );
      })}
    </svg>
  );
}

const input = 'h-10 w-full rounded-md border border-line-strong bg-surface px-2 tabular-nums';

/** Propiedades del elemento seleccionado. `compact` reduce el texto de ayuda. */
export function Inspector({ ed, compact = false }: { ed: Ed; compact?: boolean }) {
  const { el } = ed;
  const table = el?.type === 'table' ? ed.tables.find((t) => t.id === el.table_id) : undefined;
  const [draftLabel, setDraftLabel] = useState(table?.label ?? '');
  useEffect(() => setDraftLabel(table?.label ?? ''), [table?.id, table?.label]);
  if (!el) return null;
  const labelError = table && draftLabel.trim() !== table.label && ed.labelTaken(draftLabel, table.id) ? 'Ya hay otra mesa con ese nombre en este espacio.' : '';

  return (
    <div className="space-y-4 text-sm">
      {table && (
        <label className="block">
          <span className="mb-1 block font-medium">Nombre de la mesa</span>
          <span className="flex gap-2">
            <input value={draftLabel} maxLength={30} onChange={(e) => setDraftLabel(e.target.value)} aria-invalid={!!labelError} className={input} />
            <Button size="sm" variant="secondary" className="h-10" disabled={!draftLabel.trim() || draftLabel.trim() === table.label || !!labelError} onClick={() => ed.renameTable(table.id, draftLabel.trim())}>Cambiar</Button>
          </span>
          {labelError ? <span className="mt-1 block text-danger">{labelError}</span> : !compact && <span className="mt-1 block text-muted">Cambia el nombre en todo el sistema, no solo en el plano.</span>}
        </label>
      )}
      {el.type === 'table' && (
        <fieldset>
          <legend className="mb-1 font-medium">Forma</legend>
          <div className="grid grid-cols-3 gap-1">
            {SHAPES.map(([shape, label]) => (
              <button key={shape} type="button" aria-pressed={el.shape === shape} onClick={() => ed.update(el.id, { shape, ...(shape === 'rect' ? { width: 140, height: 70 } : { height: el.width }) })}
                className={cn('h-10 rounded-md border text-xs font-medium', el.shape === shape ? 'border-ink bg-ink text-warm' : 'border-line-strong hover:bg-sunken')}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {el.type === 'label' && (
        <label className="block">
          <span className="mb-1 block font-medium">Texto</span>
          <input value={el.text} maxLength={LAYOUT_LABEL_MAX} onChange={(e) => ed.update(el.id, { text: e.target.value })} className={input} />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        {(sized(el) ? (['width', 'height', 'x', 'y'] as const) : (['x', 'y'] as const)).map((k) => (
          <label key={k}>
            <span className="mb-1 block font-medium">{{ width: 'Ancho', height: 'Alto', x: 'Posición X', y: 'Posición Y' }[k]}</span>
            <input
              type="number" min={k === 'width' || k === 'height' ? 10 : 0} step={ed.snap ? GRID : 1} value={(el as unknown as Record<string, number>)[k]} className={input}
              onChange={(e) => (k === 'x' || k === 'y' ? ed.moveTo(el, k === 'x' ? Number(e.target.value) : el.x, k === 'y' ? Number(e.target.value) : el.y) : ed.update(el.id, { [k]: Math.max(10, Number(e.target.value) || 10) }))}
            />
          </label>
        ))}
      </div>
      {!compact && <p className="-mt-2 text-xs text-muted">Unidades del lienzo, no metros.</p>}
      <label className="block">
        <span className="mb-1 flex items-center justify-between font-medium">Giro <span className="tabular-nums text-muted">{el.rotation}°</span></span>
        <span className="flex items-center gap-2">
          <input type="range" min={0} max={345} step={15} value={el.rotation} onChange={(e) => ed.update(el.id, { rotation: Number(e.target.value) })} className="w-full accent-[var(--focus)]" />
          <Button size="sm" variant="ghost" aria-label="Girar 15 grados" onClick={() => ed.update(el.id, { rotation: (el.rotation + 15) % 360 })}><RotateCw aria-hidden className="size-4" /></Button>
        </span>
      </label>
      {table && (
        <p className="flex items-center justify-between rounded-md bg-sunken px-3 py-2">
          Tiene botón <span className="font-semibold">{table.hasButton ? 'Sí' : 'No'}</span>
        </p>
      )}
      {table && ed.areas.length > 0 && (
        <p className="-mt-2 flex items-center justify-between rounded-md bg-sunken px-3 py-2" title="Sale de dónde está la mesa: muévela a otra área para cambiarla.">
          Área <span className="font-semibold">{ed.areaOf(el)?.name ?? 'Sin área'}</span>
        </p>
      )}
      <div>
        <Button size="sm" variant="secondary" className="w-full" onClick={() => ed.remove(el.id)}>
          <Trash aria-hidden className="size-4" />{el.type === 'table' ? 'Quitar del plano' : 'Eliminar'}
        </Button>
        {table && !compact && <p className="mt-1 text-xs text-muted">La mesa sigue existiendo y recibiendo llamados. Desactivarla se hace en Mesas.</p>}
      </div>
    </div>
  );
}

/** Propiedades de un área: nombre (el que se verá en métricas), tamaño y qué mesas quedan dentro. */
export function AreaInspector({ ed }: { ed: Ed }) {
  const { area } = ed;
  if (!area) return null;
  const inside = ed.tablesIn(area);
  return (
    <div className="space-y-4 text-sm">
      <label className="block">
        <span className="mb-1 block font-medium">Nombre del área</span>
        <input value={area.name} maxLength={60} onChange={(e) => ed.updateArea(area.id, { name: e.target.value })} className={input} />
        <span className="mt-1 block text-muted">Así aparecerá en las métricas.</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(['width', 'height'] as const).map((k) => (
          <label key={k}>
            <span className="mb-1 block font-medium">{k === 'width' ? 'Ancho' : 'Alto'}</span>
            <input type="number" min={60} step={ed.snap ? GRID : 1} value={area[k]} onChange={(e) => ed.updateArea(area.id, { [k]: Math.max(60, Number(e.target.value) || 60) })} className={input} />
          </label>
        ))}
      </div>
      <div>
        <p className="mb-1 font-medium">Mesas en esta área ({inside.length})</p>
        <p className="text-muted">{inside.length ? inside.join(', ') : 'Ninguna. Arrastra mesas dentro del área.'}</p>
      </div>
      <div>
        <Button size="sm" variant="secondary" className="w-full" onClick={() => ed.removeArea(area.id)}><Trash aria-hidden className="size-4" />Eliminar área</Button>
        <p className="mt-1 text-xs text-muted">Las mesas no se mueven ni se borran; quedan sin área. Las métricas pasadas conservan el área que tenían.</p>
      </div>
    </div>
  );
}

/** Mesas del espacio que no están en el plano: ubicar con un toque o arrastrándolas al lienzo, o crear una nueva. */
export function UnplacedTables({ ed, autoFocus = false }: { ed: Ed; autoFocus?: boolean }) {
  const [label, setLabel] = useState('');
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {ed.unplaced.map((t, i) => (
          <li
            key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/table-id', t.id)}
            className="flex cursor-grab items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2"
          >
            <span>
              <span className="block font-display font-bold">{t.label}</span>
              <span className="text-xs text-muted">{t.hasButton ? 'Con botón' : 'Sin botón'}</span>
            </span>
            <Button size="sm" variant="secondary" autoFocus={autoFocus && i === 0} onClick={() => ed.place(t)}>Ubicar</Button>
          </li>
        ))}
        {ed.unplaced.length === 0 && <li className="text-sm text-muted">Todas las mesas de {ed.space.name} están en el plano.</li>}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ed.createTable(label).then((ok) => ok && setLabel('')); }}>
        <label className="sr-only" htmlFor="new-table">Nombre de la mesa nueva</label>
        <input id="new-table" value={label} maxLength={30} placeholder="Mesa 18" onChange={(e) => setLabel(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-sm" />
        <Button size="sm" type="submit">Añadir mesa</Button>
      </form>
    </div>
  );
}

function Dialog({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" className="w-full max-w-md rounded-lg border border-line bg-surface p-6 text-fg shadow-xl">
        <h2 id="dlg-title" className="mb-2 text-lg font-bold">{title}</h2>
        <div className="mb-5 text-sm text-muted">{children}</div>
        <div className="flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

/** Cambio de espacio con cambios sin guardar, confirmación de publicación y conflicto 409. */
export function EditorDialogs({ ed }: { ed: Ed }) {
  const target = ed.spaces.find((s) => s.id === ed.pendingSpace);
  return (
    <>
      {target && (
        <Dialog title={`Tienes cambios sin guardar en ${ed.space.name}`} actions={<>
          <Button size="sm" variant="ghost" onClick={() => ed.resolvePending('stay')}>Seguir editando</Button>
          <Button size="sm" variant="secondary" onClick={() => ed.resolvePending('discard')}>Descartar cambios</Button>
          <Button size="sm" autoFocus onClick={() => ed.resolvePending('save')}>Guardar e ir a {target.name}</Button>
        </>}>
          Si cambias de espacio sin guardar, se pierden. Lo publicado no cambia en ningún caso.
        </Dialog>
      )}
      {ed.confirmPublish && (
        <Dialog title={`Publicar el plano de ${ed.space.name}`} actions={<>
          <Button size="sm" variant="ghost" onClick={() => ed.setConfirmPublish(false)}>Cancelar</Button>
          <Button size="sm" autoFocus onClick={ed.publish}>Publicar plano</Button>
        </>}>
          Este plano será visible para el personal del local. El borrador dejará de estar activo.
          {ed.dirty && ' Antes se guardan tus cambios.'}
          {ed.hits.size > 0 && ' Hay elementos encimados: revisa que las mesas se lean bien.'}
        </Dialog>
      )}
      {ed.conflict && (
        <Dialog title="Conflicto de edición" actions={<>
          <Button size="sm" variant="secondary" onClick={() => ed.resolveConflict('keep')}>Conservar mis cambios para revisar</Button>
          <Button size="sm" autoFocus onClick={() => ed.resolveConflict('reload')}>Recargar versión actual</Button>
        </>}>
          Alguien guardó este plano mientras lo editabas. No se sobrescribió nada: carga su versión o conserva la tuya para revisarla.
        </Dialog>
      )}
    </>
  );
}
