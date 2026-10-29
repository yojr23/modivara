import { LAYOUT_LABEL_MAX, type LayoutElement } from '@modivara/hospitality-contracts';
import { DoorOpen, Eye, GlassWater, Minus, Plus, RotateCw, Save, Send, Trash, TriangleAlert, Type, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { ElementShape, SPACES, TABLES, tableById, type Space, type Table } from './plan';

// [DISEÑO] L-05 — editor visual de espacios (ADR-003 ESP-01…ESP-22). Prototipo: guardar y publicar son locales.

const GRID = 20;
type Sized = Exclude<LayoutElement, { type: 'label' }>;
const sized = (el: LayoutElement): el is Sized => el.type !== 'label';
const clone = (s: Space[]) => s.map((x) => ({ ...x, elements: x.elements.map((e) => ({ ...e })) }));
const SHAPES = [['round', 'Redonda'], ['square', 'Cuadrada'], ['rect', 'Rectangular']] as const;
const KIND: Record<LayoutElement['type'], string> = { table: 'Mesa', wall: 'Pared', door: 'Puerta', bar: 'Barra', label: 'Texto' };

// ponytail: superposición por cajas sin girar; basta para avisar (E-07 no bloquea). Con giros reales, usar SAT.
function overlaps(els: LayoutElement[]): Set<string> {
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

export default function Editor() {
  const [spaces, setSpaces] = useState(() => clone(SPACES));
  const [saved, setSaved] = useState(() => clone(SPACES));
  const [tables, setTables] = useState<Table[]>(TABLES);
  const [revision, setRevision] = useState<Record<string, number>>({ salon: 3, terraza: 1 });
  const [published, setPublished] = useState<Record<string, number>>({ salon: 2, terraza: 1 });
  const [spaceId, setSpaceId] = useState(SPACES[0]!.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const space = spaces.find((s) => s.id === spaceId)!;
  const savedSpace = saved.find((s) => s.id === spaceId);
  const dirty = JSON.stringify(space) !== JSON.stringify(savedSpace);
  const el = space.elements.find((e) => e.id === selected);
  const hits = useMemo(() => overlaps(space.elements), [space.elements]);
  const placed = new Set(space.elements.flatMap((e) => (e.type === 'table' ? [e.table_id] : [])));
  const unplaced = tables.filter((t) => t.spaceId === spaceId && !placed.has(t.id));

  const setElements = (fn: (els: LayoutElement[]) => LayoutElement[]) =>
    setSpaces((all) => all.map((s) => (s.id === spaceId ? { ...s, elements: fn(s.elements) } : s)));
  const update = (id: string, patch: Record<string, unknown>) =>
    setElements((els) => els.map((e) => (e.id === id ? ({ ...e, ...patch } as LayoutElement) : e)));
  const round = (v: number) => (snap ? Math.round(v / GRID) * GRID : Math.round(v));
  const clampX = (e: LayoutElement, x: number) => Math.min(Math.max(0, x), space.width - (sized(e) ? e.width : 0));
  const clampY = (e: LayoutElement, y: number) => Math.min(Math.max(0, y), space.height - (sized(e) ? e.height : 0));
  const moveTo = (e: LayoutElement, x: number, y: number) => update(e.id, { x: clampX(e, x), y: clampY(e, y) });

  function add(next: LayoutElement) {
    setElements((els) => [...els, next]);
    setSelected(next.id);
  }
  const center = (w: number, h: number) => ({ x: round(space.width / 2 - w / 2), y: round(space.height / 2 - h / 2), rotation: 0 });
  const addBox = (type: 'wall' | 'door' | 'bar', width: number, height: number) => add({ id: crypto.randomUUID(), type, width, height, ...center(width, height) });
  const place = (t: Table) => add({ id: crypto.randomUUID(), type: 'table', table_id: t.id, shape: 'round', width: 70, height: 70, ...center(70, 70) });

  function remove(id: string) {
    setElements((els) => els.filter((e) => e.id !== id));
    setSelected(null);
  }

  function createTable() {
    const label = newLabel.trim();
    if (!label) return setMessage('Escribe el nombre de la mesa.');
    if (tables.some((t) => t.spaceId === spaceId && t.label.toLowerCase() === label.toLowerCase()))
      return setMessage(`Ya existe «${label}» en ${space.name}. Usa otro nombre.`);
    const t: Table = { id: crypto.randomUUID(), label, spaceId };
    tableById.set(t.id, t);
    setTables((all) => [...all, t]);
    setNewLabel('');
    place(t);
    setMessage(`${label} creada y ubicada en el centro del plano.`);
  }

  function save() {
    setSaved((all) => all.map((s) => (s.id === spaceId ? clone([space])[0]! : s)));
    setRevision((r) => ({ ...r, [spaceId]: (r[spaceId] ?? 0) + 1 }));
    setMessage('Borrador guardado. El tablero sigue mostrando la versión publicada.');
  }

  function publish() {
    const outside = space.elements.filter(sized).find((e) => e.x + e.width > space.width || e.y + e.height > space.height);
    if (outside) {
      setSelected(outside.id);
      return setMessage(`${KIND[outside.type]} se sale del lienzo. Muévela dentro antes de publicar.`);
    }
    if (dirty) save();
    const v = (published[spaceId] ?? 0) + 1;
    setPublished((p) => ({ ...p, [spaceId]: v }));
    setMessage(`Publicado. El tablero ya muestra la versión ${v} de ${space.name}.`);
  }

  function discard() {
    setSpaces((all) => all.map((s) => (s.id === spaceId ? clone([savedSpace!])[0]! : s)));
    setSelected(null);
    setMessage('Cambios descartados. Volviste al último borrador guardado.');
  }

  function addSpace() {
    const s: Space = { id: crypto.randomUUID(), name: 'Espacio nuevo', width: 800, height: 500, elements: [] };
    setSpaces((all) => [...all, s]);
    setSaved((all) => [...all, clone([s])[0]!]);
    setSpaceId(s.id);
    setSelected(null);
  }

  const toCanvas = (e: PointerEvent) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());

  function onElementDown(e: PointerEvent, target: LayoutElement) {
    if (preview) return;
    e.stopPropagation();
    setSelected(target.id);
    const p = toCanvas(e);
    drag.current = { id: target.id, dx: p.x - target.x, dy: p.y - target.y };
    svg.current!.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    const d = drag.current;
    const target = d && space.elements.find((x) => x.id === d.id);
    if (!d || !target) return;
    const p = toCanvas(e);
    moveTo(target, round(p.x - d.dx), round(p.y - d.dy));
  }

  function onKey(e: KeyboardEvent, target: LayoutElement) {
    const step = e.shiftKey ? 1 : GRID;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (delta) {
      e.preventDefault();
      moveTo(target, target.x + delta[0]!, target.y + delta[1]!);
    } else if (e.key === 'r' || e.key === 'R') update(target.id, { rotation: (target.rotation + 15) % 360 });
    else if (e.key === 'Delete' || e.key === 'Backspace') remove(target.id);
  }

  const nameOf = (e: LayoutElement) => (e.type === 'table' ? tableById.get(e.table_id)?.label : e.type === 'label' ? `Texto «${e.text}»` : KIND[e.type]);

  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr] bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-3">
        <div>
          <Link to="/_proto/tablero" className="text-sm text-link underline">Ir al tablero</Link>
          <h1 className="text-xl font-bold">Editor de espacios</h1>
        </div>
        <nav aria-label="Espacios" className="flex flex-wrap items-center gap-1">
          {spaces.map((s) => (
            <button
              key={s.id} type="button" aria-current={s.id === spaceId ? 'page' : undefined}
              onClick={() => { setSpaceId(s.id); setSelected(null); }}
              className={cn('h-10 rounded-md px-3 text-sm font-semibold', s.id === spaceId ? 'bg-ink text-warm' : 'text-muted hover:bg-sunken')}
            >
              {s.name}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={addSpace}><Plus aria-hidden className="size-4" />Espacio</Button>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <p className="mr-2 text-sm text-muted" aria-live="polite">
            {dirty ? <span className="font-semibold text-fg">Cambios sin guardar</span> : `Borrador guardado (revisión ${revision[spaceId] ?? 0})`}
            <br />
            {published[spaceId] ? `Publicado: versión ${published[spaceId]}` : 'Sin publicar'}
          </p>
          <Button size="sm" variant="ghost" onClick={discard} disabled={!dirty}>Descartar</Button>
          <Button size="sm" variant="secondary" onClick={save} disabled={!dirty}><Save aria-hidden className="size-4" />Guardar borrador</Button>
          <Button size="sm" onClick={publish}><Send aria-hidden className="size-4" />Publicar</Button>
        </div>
      </header>

      <div className="grid gap-0 lg:grid-cols-[88px_1fr_320px]">
        <aside aria-label="Herramientas" className="flex gap-1 overflow-x-auto border-b border-line bg-surface p-2 lg:flex-col lg:border-r lg:border-b-0">
          {([
            [Minus, 'Pared', () => addBox('wall', 200, 14)],
            [DoorOpen, 'Puerta', () => addBox('door', 100, 14)],
            [GlassWater, 'Barra', () => addBox('bar', 300, 56)],
            [Type, 'Texto', () => add({ id: crypto.randomUUID(), type: 'label', text: 'Texto', ...center(0, 0) })],
          ] as const).map(([Icon, label, onClick]) => (
            <button key={label} type="button" onClick={onClick} disabled={preview} className="flex min-w-16 flex-col items-center gap-1 rounded-md p-2 text-xs font-medium hover:bg-sunken disabled:opacity-50">
              <Icon aria-hidden className="size-5" />
              {label}
            </button>
          ))}
        </aside>

        <section aria-label={`Lienzo de ${space.name}`} className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 text-sm">
            <label className="flex items-center gap-2">
              Nombre del espacio
              <input value={space.name} maxLength={60} onChange={(e) => setSpaces((all) => all.map((s) => (s.id === spaceId ? { ...s, name: e.target.value } : s)))} className="h-9 rounded-md border border-line-strong bg-surface px-2" />
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} className="size-4" />Ajustar a la cuadrícula</label>
            <Button size="sm" variant={preview ? 'primary' : 'ghost'} aria-pressed={preview} onClick={() => { setPreview(!preview); setSelected(null); }}>
              <Eye aria-hidden className="size-4" />Previsualizar
            </Button>
            {hits.size > 0 && !preview && (
              <span role="status" className="flex items-center gap-1.5 rounded-md bg-pending/25 px-2 py-1 font-medium" title="Se puede publicar igual; revisa que se lean bien.">
                <TriangleAlert aria-hidden className="size-4" /> Elementos encimados (borde punteado)
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label="Alejar" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut aria-hidden className="size-4" /></Button>
              <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)} %</span>
              <Button size="sm" variant="ghost" aria-label="Acercar" onClick={() => setZoom((z) => Math.min(2, z + 0.25))}><ZoomIn aria-hidden className="size-4" /></Button>
            </span>
          </div>
          <div className="flex-1 overflow-auto bg-sunken p-4">
            <svg
              ref={svg} viewBox={`0 0 ${space.width} ${space.height}`} style={{ height: `calc(${zoom} * (100dvh - 190px))` }}
              className="mx-auto block max-w-none rounded-lg bg-surface shadow-[0_1px_0_var(--border)]"
              onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerDown={() => setSelected(null)}
            >
              <defs>
                <pattern id="dots" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                  <circle cx={1} cy={1} r={1.2} className="fill-line-strong/50" />
                </pattern>
              </defs>
              {!preview && <rect width={space.width} height={space.height} fill="url(#dots)" />}
              {space.elements.map((e) => (
                <g
                  key={e.id} tabIndex={preview ? -1 : 0} role="button" aria-label={`${nameOf(e)}. Flechas para mover, R para girar, Suprimir para quitar.`}
                  aria-pressed={e.id === selected} onPointerDown={(ev) => onElementDown(ev, e)} onKeyDown={(ev) => onKey(ev, e)} onFocus={() => setSelected(e.id)}
                  className={cn('outline-none', !preview && 'cursor-grab touch-none')}
                >
                  <ElementShape el={e} warn={!preview && hits.has(e.id)} />
                  {e.id === selected && sized(e) && (
                    <rect x={e.x - 6} y={e.y - 6} width={e.width + 12} height={e.height + 12} rx={10} fill="none" strokeWidth={2} className="stroke-focus" transform={`rotate(${e.rotation} ${e.x + e.width / 2} ${e.y + e.height / 2})`} />
                  )}
                  {e.id === selected && e.type === 'label' && <circle cx={e.x - 8} cy={e.y - 6} r={5} className="fill-focus" />}
                </g>
              ))}
            </svg>
          </div>
        </section>

        <aside className="space-y-6 border-t border-line bg-surface p-4 lg:border-t-0 lg:border-l">
          <section aria-labelledby="props">
            <h2 id="props" className="mb-3 text-base font-bold">{el ? nameOf(el) : 'Propiedades'}</h2>
            {!el && <p className="text-sm text-muted">Toca un elemento del plano para cambiar su forma, tamaño o giro.</p>}
            {el && (
              <div className="space-y-4 text-sm">
                {el.type === 'table' && (
                  <fieldset>
                    <legend className="mb-1 font-medium">Forma</legend>
                    <div className="grid grid-cols-3 gap-1">
                      {SHAPES.map(([shape, label]) => (
                        <button key={shape} type="button" aria-pressed={el.shape === shape} onClick={() => update(el.id, { shape, ...(shape === 'rect' ? { width: 140, height: 70 } : { height: el.width }) })}
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
                    <input value={el.text} maxLength={LAYOUT_LABEL_MAX} onChange={(e) => update(el.id, { text: e.target.value })} className="h-10 w-full rounded-md border border-line-strong bg-surface px-2" />
                  </label>
                )}
                {sized(el) && (
                  <div className="grid grid-cols-2 gap-2">
                    {(['width', 'height'] as const).map((k) => (
                      <label key={k}>
                        <span className="mb-1 block font-medium">{k === 'width' ? 'Ancho' : 'Alto'}</span>
                        <input type="number" min={10} step={snap ? GRID : 1} value={el[k]} onChange={(e) => update(el.id, { [k]: Math.max(10, Number(e.target.value) || 10) })} className="h-10 w-full rounded-md border border-line-strong bg-surface px-2 tabular-nums" />
                      </label>
                    ))}
                  </div>
                )}
                <label className="block">
                  <span className="mb-1 flex items-center justify-between font-medium">Giro <span className="tabular-nums text-muted">{el.rotation}°</span></span>
                  <span className="flex items-center gap-2">
                    <input type="range" min={0} max={345} step={15} value={el.rotation} onChange={(e) => update(el.id, { rotation: Number(e.target.value) })} className="w-full accent-[var(--primary)]" />
                    <Button size="sm" variant="ghost" aria-label="Girar 15 grados" onClick={() => update(el.id, { rotation: (el.rotation + 15) % 360 })}><RotateCw aria-hidden className="size-4" /></Button>
                  </span>
                </label>
                <Button size="sm" variant="secondary" className="w-full" onClick={() => remove(el.id)}>
                  <Trash aria-hidden className="size-4" />{el.type === 'table' ? 'Quitar del plano' : 'Eliminar'}
                </Button>
              </div>
            )}
          </section>

          <section aria-labelledby="unplaced">
            <h2 id="unplaced" className="mb-1 text-base font-bold">Mesas sin ubicar <span className="text-muted tabular-nums">({unplaced.length})</span></h2>
            <p className="mb-3 text-sm text-muted">Siguen recibiendo llamados; solo no aparecen en el plano.</p>
            <ul className="space-y-1">
              {unplaced.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                  <span className="font-display font-bold">{t.label}</span>
                  <Button size="sm" variant="secondary" onClick={() => place(t)} disabled={preview}>Ubicar</Button>
                </li>
              ))}
              {unplaced.length === 0 && <li className="text-sm text-muted">Todas las mesas de {space.name} están en el plano.</li>}
            </ul>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); createTable(); }}>
              <label className="sr-only" htmlFor="new-table">Nombre de la mesa nueva</label>
              <input id="new-table" value={newLabel} maxLength={30} placeholder="Mesa 17" onChange={(e) => setNewLabel(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-sm" />
              <Button size="sm" type="submit" disabled={preview}>Crear y ubicar</Button>
            </form>
          </section>

          <p className="min-h-5 text-sm" role="status" aria-live="polite">{message}</p>
        </aside>
      </div>
    </div>
  );
}
