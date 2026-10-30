import { Check, Plus, Send, SquareDashed, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { ACTIVITY, AREA_STYLE, RANGES, tableById } from './plan';
import { AreaInspector, EditorDialogs, Inspector, KIND, PlanCanvas, ProtoBar, TOOLS, UnplacedTables, nameOf, useLayoutEditor, type Ed, type ToolId } from './editor-kit';

// [DISEÑO] L-05, versión elegida por el responsable (29/10/2026): alternativa E, mezcla de A (barra lateral de espacios) y C (paleta
// visible, «¿Qué falta?», revisión antes de publicar), con áreas dentro de cada espacio y modo Actividad. Las alternativas A–D descartadas
// están en la historia de la rama `diseno/l05-mesas` (commit 664f201).

type AddTool = Exclude<ToolId, 'select' | 'table'>;
const REFS = TOOLS.filter((t) => t.id !== 'select' && t.id !== 'table');

/** Isotipo provisional: tres módulos conectados (BRAND-002 §9, sin logotipo aprobado). */
function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg aria-hidden viewBox="0 0 26 10" className="h-2.5 w-7">
        <rect width="8" height="10" rx="2" className="fill-connect" />
        <rect x="9" width="8" height="10" rx="2" className="fill-interface" />
        <rect x="18" width="8" height="10" rx="2" className={dark ? 'fill-warm' : 'fill-ink'} />
      </svg>
      <span className="font-display text-lg font-extrabold tracking-tight">Modivara</span>
    </span>
  );
}

function Zoom({ ed }: { ed: Ed }) {
  return (
    <span className="flex items-center gap-1">
      <Button size="sm" variant="ghost" aria-label="Alejar" onClick={() => ed.setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut aria-hidden className="size-4" /></Button>
      <span className="w-12 text-center text-sm tabular-nums">{Math.round(ed.zoom * 100)} %</span>
      <Button size="sm" variant="ghost" aria-label="Acercar" onClick={() => ed.setZoom((z) => Math.min(2, z + 0.25))}><ZoomIn aria-hidden className="size-4" /></Button>
      <Button size="sm" variant="ghost" onClick={() => ed.setZoom(1)}>Ajustar</Button>
    </span>
  );
}

function OverlapNote({ ed }: { ed: Ed }) {
  if (ed.hits.size === 0) return null;
  return (
    <span role="status" className="flex items-center gap-1.5 text-sm font-medium" title="Se puede publicar igual; revisa que se lean bien.">
      <TriangleAlert aria-hidden className="size-4 text-pending" /> Elementos encimados (borde punteado)
    </span>
  );
}

/* ─────────────── Piezas del editor ─────────────── */

function CheckRow({ ok, warn = false, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-done-fg" /> : <TriangleAlert aria-hidden className={cn('mt-0.5 size-4 shrink-0', warn ? 'text-pending' : 'text-danger')} />}
      <span><span className="sr-only">{ok ? 'Listo: ' : warn ? 'Aviso: ' : 'Falta: '}</span>{children}</span>
    </li>
  );
}

/** Paleta visible: mesas reales del espacio y elementos de referencia (tocar o arrastrar al plano). */
function Palette({ ed }: { ed: Ed }) {
  const here = ed.tables.filter((t) => t.spaceId === ed.spaceId).length;
  return (
    <>
      <section aria-labelledby="pal-tables">
        <h2 id="pal-tables" className="font-display text-lg font-bold">Mesas de {ed.space.name}</h2>
        <p className="mb-3 text-sm text-muted">{here - ed.unplaced.length} de {here} en el plano. Arrastra o toca Ubicar.</p>
        <UnplacedTables ed={ed} />
      </section>
      <section aria-labelledby="pal-areas" className="border-t border-line pt-5">
        <h2 id="pal-areas" className="mb-1 font-display text-lg font-bold">Áreas</h2>
        <p className="mb-3 text-sm text-muted">Agrupan mesas (barra, ventanal, VIP…). Cada mesa toma el área donde está; así se verán las métricas por área.</p>
        <button
          type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/tool', 'area')} onClick={() => ed.addArea()}
          className="flex h-12 w-full cursor-grab items-center justify-center gap-2 rounded-md border border-dashed border-line-strong text-sm font-medium hover:bg-sunken"
        >
          <SquareDashed aria-hidden className="size-5" />Dibujar área
        </button>
      </section>
      <section aria-labelledby="pal-refs" className="border-t border-line pt-5">
        <h2 id="pal-refs" className="mb-1 font-display text-lg font-bold">Elementos del local</h2>
        <p className="mb-3 text-sm text-muted">Toca para añadir al centro o arrastra al plano. No reciben llamados.</p>
        <div className="grid grid-cols-2 gap-2">
          {REFS.map(({ id, label, Icon }) => (
            <button
              key={id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/tool', id)} onClick={() => ed.addTool(id as AddTool)}
              className="flex h-16 cursor-grab flex-col items-center justify-center gap-1 rounded-md border border-line text-sm font-medium hover:border-line-strong hover:bg-sunken"
            >
              <Icon aria-hidden className="size-5" />{label}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

/** «¿Qué falta?»: estado del borrador mientras se distribuye. */
function Todo({ ed }: { ed: Ed }) {
  return (
    <section aria-labelledby="todo">
      <h2 id="todo" className="mb-3 font-display text-lg font-bold">¿Qué falta?</h2>
      <ul className="space-y-2">
        <CheckRow ok={ed.unplaced.length === 0} warn>{ed.unplaced.length ? `${ed.unplaced.length} mesas sin ubicar` : 'Todas las mesas están en el plano'}</CheckRow>
        <CheckRow ok={ed.outside.length === 0}>{ed.outside.length ? `${ed.outside.length} elementos fuera del lienzo` : 'Todo dentro del lienzo'}</CheckRow>
        <CheckRow ok={ed.hits.size === 0} warn>{ed.hits.size ? 'Hay elementos encimados (no impide publicar)' : 'Nada encimado'}</CheckRow>
        {ed.areas.length > 0 && <CheckRow ok={!ed.areaOverlap}>{ed.areaOverlap ? 'Hay áreas encimadas: sepáralas' : 'Áreas sin encimarse'}</CheckRow>}
        {ed.areas.length > 0 && <CheckRow ok={ed.withoutArea.length === 0} warn>{ed.withoutArea.length ? `Sin área: ${ed.withoutArea.join(', ')}` : 'Cada mesa tiene área'}</CheckRow>}
        <CheckRow ok={!ed.dirty} warn>{ed.dirty ? 'Cambios sin guardar' : 'Borrador guardado'}</CheckRow>
      </ul>
      <p className="mt-6 text-sm text-muted">Toca una mesa para cambiar su nombre o su forma. Arrástrala para moverla; el tirador de arriba la gira.</p>
    </section>
  );
}

/** Revisión previa a publicar: comprobaciones, conteo y botón final. */
function Review({ ed }: { ed: Ed }) {
  const count = (type: string) => ed.space.elements.filter((e) => e.type === type).length;
  return (
    <div className="space-y-6">
      <section aria-labelledby="review">
        <h2 id="review" className="mb-3 font-display text-xl font-bold">Revisar {ed.space.name}</h2>
        <ul className="space-y-2">
          <CheckRow ok>Cada mesa aparece una sola vez</CheckRow>
          <CheckRow ok>Todas las mesas son de {ed.space.name}</CheckRow>
          <CheckRow ok={ed.outside.length === 0}>{ed.outside.length ? 'Hay elementos fuera del lienzo: muévelos dentro' : 'Todo dentro del lienzo'}</CheckRow>
          <CheckRow ok={ed.hits.size === 0} warn>{ed.hits.size ? 'Hay elementos encimados; se puede publicar' : 'Nada encimado'}</CheckRow>
          <CheckRow ok={ed.unplaced.length === 0} warn>{ed.unplaced.length ? `${ed.unplaced.length} mesas sin ubicar: sus llamados siguen llegando a la cola` : 'Todas las mesas ubicadas'}</CheckRow>
          {ed.areas.length > 0 && <CheckRow ok={!ed.areaOverlap}>{ed.areaOverlap ? 'Hay áreas encimadas: no se puede publicar' : 'Áreas sin encimarse'}</CheckRow>}
          {ed.areas.length > 0 && <CheckRow ok={ed.withoutArea.length === 0} warn>{ed.withoutArea.length ? `Sin área en métricas: ${ed.withoutArea.join(', ')}` : 'Cada mesa tiene área'}</CheckRow>}
        </ul>
      </section>
      {ed.areaChanges.length > 0 && (
        <section aria-labelledby="review-areas">
          <h3 id="review-areas" className="mb-2 font-bold">Mesas que cambian de área</h3>
          <ul className="space-y-1 text-sm">
            {ed.areaChanges.map((c) => (
              <li key={c.label}><span className="font-semibold">{c.label}</span>: {c.before ?? 'sin área'} a {c.after ?? 'sin área'}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Las métricas de antes conservan el área que tenían; las nuevas usan la nueva.</p>
        </section>
      )}
      <section aria-labelledby="review-sum">
        <h3 id="review-sum" className="mb-2 font-bold">Contenido</h3>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          {([['Mesas en el plano', count('table')], ['Mesas sin ubicar', ed.unplaced.length], ['Barras', count('bar')], ['Puertas', count('door')], ['Paredes', count('wall')], ['Etiquetas', count('label')]] as const).map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold tabular-nums">{v}</dd></div>
          ))}
        </dl>
      </section>
      <p className="text-sm text-muted">
        Al publicar, el tablero del personal muestra este plano{ed.published ? ` y la versión ${ed.published} pasa al archivo` : ''}.
      </p>
      <Button size="lg" className="w-full" onClick={ed.requestPublish} disabled={ed.outside.length > 0 || ed.areaOverlap}><Send aria-hidden className="size-5" />Publicar plano</Button>
    </div>
  );
}

const fmtSeconds = (s: number) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;

/** Movimiento por área del espacio: ranking de llamados, tiempo promedio hasta «En atención» y mesas con más llamados. */
function Activity({ ed, heat, range, setRange }: { ed: Ed; heat: (id: string) => number; range: string; setRange: (r: (typeof RANGES)[number][0]) => void }) {
  const tables = ed.space.elements.filter((e) => e.type === 'table');
  const groups = [...ed.areas, undefined].map((a) => {
    const inside = tables.filter((e) => ed.areaOf(e)?.id === a?.id);
    const calls = inside.reduce((s, e) => s + heat(e.table_id), 0);
    const weighted = inside.reduce((s, e) => s + heat(e.table_id) * (ACTIVITY.get(e.table_id)?.ackSeconds ?? 0), 0);
    return { name: a?.name ?? 'Sin área', calls, ack: calls ? weighted / calls : 0, tables: inside.length };
  }).filter((g) => g.tables > 0).sort((a, b) => b.calls - a.calls);
  const max = Math.max(1, ...groups.map((g) => g.calls));
  const top = [...tables].sort((a, b) => heat(b.table_id) - heat(a.table_id)).slice(0, 5);

  return (
    <section aria-labelledby="act" className="space-y-6">
      <div>
        <h2 id="act" className="font-display text-lg font-bold">Movimiento por área</h2>
        <p className="text-sm text-muted">Llamados en {ed.space.name}. Más color en el plano, más llamados.</p>
      </div>
      <div role="group" aria-label="Periodo" className="grid grid-cols-3 rounded-md border border-line p-0.5">
        {RANGES.map(([r, label]) => (
          <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={cn('h-9 rounded text-sm font-semibold', range === r ? 'bg-ink text-warm' : 'text-muted hover:bg-sunken')}>{label}</button>
        ))}
      </div>
      <ol className="space-y-4">
        {groups.map((g) => (
          <li key={g.name}>
            <p className="flex items-baseline justify-between">
              <span className="font-semibold">{g.name}</span>
              <span className="font-display text-xl font-bold tabular-nums">{g.calls}</span>
            </p>
            <div aria-hidden className="mt-1 h-2 rounded-full bg-sunken"><div className="h-2 rounded-full bg-interface" style={{ width: `${(g.calls / max) * 100}%` }} /></div>
            <p className="mt-1 text-xs text-muted">{g.tables} mesas. {g.calls ? `En atención en promedio a los ${fmtSeconds(g.ack)}` : 'Sin llamados'}</p>
          </li>
        ))}
      </ol>
      <section aria-labelledby="act-top">
        <h3 id="act-top" className="mb-2 font-bold">Mesas con más llamados</h3>
        <ol className="space-y-1 text-sm">
          {top.map((e) => (
            <li key={e.id} className="flex justify-between gap-2">
              <span>{tableById.get(e.table_id)?.label} <span className="text-muted">({ed.areaOf(e)?.name ?? 'sin área'})</span></span>
              <span className="font-semibold tabular-nums">{heat(e.table_id)}</span>
            </li>
          ))}
        </ol>
      </section>
      <p className="text-xs text-muted">El número en cada mesa es su cantidad de llamados. Cada llamado cuenta en el área que tenía la mesa cuando llamó. Datos de prueba.</p>
    </section>
  );
}

/* ─────────────── Editor: barra lateral de espacios y áreas, paleta, plano, panel derecho ─────────────── */

export default function Editor() {
  const ed = useLayoutEditor();
  const [mode, setMode] = useState<'design' | 'review' | 'activity'>('design');
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('7d');
  const review = mode === 'review';
  const locked = mode !== 'design';
  const factor = RANGES.find((r) => r[0] === range)![2];
  const heat = (tableId: string) => Math.round((ACTIVITY.get(tableId)?.calls7d ?? 0) * factor);
  const leaveReview = () => mode === 'review' && setMode('design');
  const { space, el } = ed;

  return (
    <div className={cn('grid h-dvh grid-rows-[72px_minmax(0,1fr)] bg-bg text-fg', mode === 'activity' ? 'grid-cols-[196px_minmax(0,1fr)_340px]' : 'grid-cols-[196px_272px_minmax(0,1fr)_312px]')}>
      <nav aria-label="Espacios" className="row-span-2 flex flex-col gap-6 overflow-y-auto bg-ink px-3 py-5 text-warm">
        <div className="px-2"><Wordmark dark /></div>
        <section>
          <h2 className="mb-1 px-2 text-sm text-warm/60">Espacios (pisos o sectores)</h2>
          <ul className="space-y-0.5">
            {ed.spaces.map((s) => (
              <li key={s.id}>
                <button
                  type="button" aria-current={s.id === ed.spaceId ? 'page' : undefined} onClick={() => { ed.selectSpace(s.id); leaveReview(); }}
                  className={cn('flex h-10 w-full items-center rounded-md px-2 text-left text-sm', s.id === ed.spaceId ? 'bg-white/12 font-semibold' : 'text-warm/75 hover:bg-white/6')}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={ed.addSpace} className="mt-1 flex h-9 items-center gap-2 rounded-md px-2 text-sm text-warm/75 hover:bg-white/6">
            <Plus aria-hidden className="size-4" />Crear espacio
          </button>
        </section>
        <section className="border-t border-white/10 pt-5">
          <h2 className="mb-1 px-2 text-sm text-warm/60">Áreas en {space.name}</h2>
          <ul className="space-y-0.5">
            {ed.areas.map((a) => (
              <li key={a.id}>
                <button
                  type="button" aria-pressed={ed.area?.id === a.id} onClick={() => { ed.setSelected(a.id); leaveReview(); }}
                  className={cn('flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm', ed.area?.id === a.id ? 'bg-white/12 font-semibold' : 'text-warm/85 hover:bg-white/6')}
                >
                  <span aria-hidden className={cn('size-2.5 shrink-0 rounded-sm', AREA_STYLE[a.color % AREA_STYLE.length]!.swatch)} />
                  <span className="flex-1 truncate">{a.name}</span>
                  <span className="text-xs text-warm/60 tabular-nums">{ed.tablesIn(a).length} mesas</span>
                </button>
              </li>
            ))}
          </ul>
          {ed.areas.length > 0 && ed.withoutArea.length > 0 && <p className="px-2 pt-1 text-xs text-amber">Sin área: {ed.withoutArea.length} mesas</p>}
          <button type="button" onClick={() => ed.addArea()} className="mt-1 flex h-9 items-center gap-2 rounded-md px-2 text-sm text-warm/75 hover:bg-white/6">
            <Plus aria-hidden className="size-4" />Dibujar área
          </button>
        </section>
        <p className="mt-auto px-2 text-xs leading-relaxed text-warm/55">Flechas mueven, R gira y Supr quita del plano.</p>
      </nav>

      <header className={cn('flex items-center gap-6 border-b border-line bg-surface px-6', mode === 'activity' ? 'col-span-2' : 'col-span-3')}>
        <div>
          <p className="text-sm text-muted">Bar Demo</p>
          <h1 className="text-2xl font-bold">{space.name}</h1>
        </div>
        <div role="group" aria-label="Modo" className="flex rounded-md border border-line p-0.5">
          {([['design', 'Diseñar'], ['activity', 'Actividad']] as const).map(([m, label]) => (
            <button
              key={m} type="button" aria-pressed={m === 'design' ? mode !== 'activity' : mode === 'activity'}
              onClick={() => { ed.setSelected(null); setMode(m); }}
              className={cn('h-9 rounded px-4 text-sm font-semibold', (m === 'design') === (mode !== 'activity') ? 'bg-ink text-warm' : 'text-muted hover:bg-sunken')}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm" aria-live="polite">
          <span className={cn('font-semibold', ed.dirty ? 'text-fg' : 'text-muted')}>{ed.status}</span>
          <span className="block text-muted">{ed.publishedLine}</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {mode !== 'activity' && <>
            <Button size="sm" variant="ghost" onClick={ed.discard} disabled={!ed.dirty || locked}>Descartar</Button>
            <Button variant="secondary" onClick={ed.save} disabled={!ed.dirty || ed.saving}>Guardar borrador</Button>
            {review
              ? <Button variant="secondary" onClick={() => setMode('design')}>Volver a editar</Button>
              : <Button onClick={() => { ed.setSelected(null); setMode('review'); }}><Send aria-hidden className="size-4" />Revisar y publicar</Button>}
          </>}
        </div>
      </header>

      {mode !== 'activity' && (
        <aside aria-label="Paleta" className={cn('space-y-6 overflow-y-auto border-r border-line bg-surface p-5', locked && 'pointer-events-none opacity-50')} aria-disabled={locked}>
          <Palette ed={ed} />
        </aside>
      )}

      <main className="flex min-h-0 flex-col bg-sunken">
        {review && <p className="px-6 pt-4 text-sm text-muted">Vista previa: así verá el personal este plano. Los llamados en vivo se ven en el tablero.</p>}
        <div className="min-h-0 flex-1 overflow-auto p-6"><PlanCanvas ed={ed} readOnly={locked} heat={mode === 'activity' ? heat : undefined} /></div>
        <div className="flex h-12 items-center gap-4 border-t border-line bg-surface px-4 text-sm">
          <Zoom ed={ed} />
          {!locked && <label className="flex items-center gap-2"><input type="checkbox" checked={ed.snap} onChange={(e) => ed.setSnap(e.target.checked)} />Cuadrícula</label>}
          {!locked && <OverlapNote ed={ed} />}
          <p className="ml-auto truncate text-muted" role="status">{ed.message}</p>
        </div>
      </main>

      <aside className="overflow-y-auto border-l border-line bg-surface p-5">
        {mode === 'activity' ? <Activity ed={ed} heat={heat} range={range} setRange={setRange} /> : review ? <Review ed={ed} /> : el ? (
          <section aria-labelledby="e-props">
            <div className="mb-1 flex items-center justify-between">
              <h2 id="e-props" className="font-display text-lg font-bold">{nameOf(el)}</h2>
              <Button size="sm" variant="ghost" onClick={() => ed.setSelected(null)}>Listo</Button>
            </div>
            <p className="mb-4 text-sm text-muted">{el.type === 'table' ? 'Mesa real del local' : `${KIND[el.type]}, solo referencia visual`}</p>
            <Inspector ed={ed} />
          </section>
        ) : ed.area ? (
          <section aria-labelledby="e-area">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="e-area" className="font-display text-lg font-bold">Área</h2>
              <Button size="sm" variant="ghost" onClick={() => ed.setSelected(null)}>Listo</Button>
            </div>
            <AreaInspector ed={ed} />
          </section>
        ) : <Todo ed={ed} />}
      </aside>
      <EditorDialogs ed={ed} />
      <ProtoBar ed={ed} />
    </div>
  );
}

/* ─────────────── Índice de prototipos ─────────────── */

const PROTOS = [
  ['/_proto/l05-e', 'Editor de espacios (L-05)', 'Versión elegida: espacios por piso, áreas dentro de cada plano, mesas, elementos, revisión antes de publicar y modo Actividad.'],
  ['/_proto/tablero/a', 'Tablero sobre el plano (L-06)', 'Tres alternativas: A plano y cola, B cola protagonista, C todo el local a la vista.'],
  ['/_proto/metricas/a', 'Métricas (F5-12)', 'Tres alternativas: A informe, B sobre el plano, C franjas horarias. Llamados e inventario.'],
  ['/_proto/inventario/a', 'Inventario (F4-09)', 'Tres alternativas: A tabla de saldos, B registro rápido, C conteo de cierre.'],
] as const;

export function ProtoIndex() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-fg">
      <Wordmark />
      <h1 className="mt-6 text-3xl font-bold">Prototipos</h1>
      <p className="mt-2 mb-8 text-muted">Pantallas de diseño con datos de prueba; no llaman a la API.</p>
      <ul className="divide-y divide-line border-y border-line">
        {PROTOS.map(([to, title, text]) => (
          <li key={to}>
            <Link to={to} className="block py-4 hover:bg-surface">
              <span className="block font-display text-xl font-bold">{title}</span>
              <span className="text-muted">{text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
