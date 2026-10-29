import { Check, Plus, Send, TriangleAlert, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { EditorDialogs, Inspector, KIND, PlanCanvas, ProtoBar, TOOLS, UnplacedTables, nameOf, useLayoutEditor, type Ed, type ToolId } from './editor-kit';

// [DISEÑO] L-05: alternativas A (estudio), B (lienzo protagonista) y C (guiada) del handoff de UI/UX. Mismos datos y estado que D.

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

/* ─────────────── A — Estudio: navegación lateral, plano central, inspector persistente ─────────────── */

export function EditorA() {
  const ed = useLayoutEditor();
  const tray = useRef<HTMLHeadingElement>(null);
  const { space, el } = ed;

  return (
    <div className="grid h-dvh grid-cols-[208px_minmax(0,1fr)_336px] grid-rows-[72px_minmax(0,1fr)] bg-bg text-fg">
      <nav aria-label="Espacios y herramientas" className="row-span-2 flex flex-col gap-6 overflow-y-auto bg-ink px-3 py-5 text-warm">
        <div className="px-2"><Wordmark dark /></div>
        <section>
          <h2 className="mb-1 px-2 text-sm text-warm/60">Espacios</h2>
          <ul className="space-y-0.5">
            {ed.spaces.map((s) => (
              <li key={s.id}>
                <button
                  type="button" aria-current={s.id === ed.spaceId ? 'page' : undefined} onClick={() => ed.selectSpace(s.id)}
                  className={cn('flex h-10 w-full items-center rounded-md px-2 text-left text-sm', s.id === ed.spaceId ? 'bg-white/12 font-semibold' : 'text-warm/75 hover:bg-white/6')}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={ed.addSpace} className="mt-1 flex h-9 items-center gap-2 rounded-md px-2 text-sm text-warm/75 hover:bg-white/6">
            <Plus aria-hidden className="size-4" />Crear zona
          </button>
        </section>
        <section className="border-t border-white/10 pt-5">
          <h2 className="mb-1 px-2 text-sm text-warm/60">Herramientas</h2>
          <ul className="space-y-0.5">
            {TOOLS.map(({ id, label, Icon }) => (
              <li key={id}>
                <button
                  type="button" aria-pressed={id === 'select' ? !el : undefined}
                  onClick={() => (id === 'select' ? ed.setSelected(null) : id === 'table' ? tray.current?.focus() : ed.addTool(id as AddTool))}
                  className={cn('flex h-10 w-full items-center gap-3 rounded-md px-2 text-sm', id === 'select' && !el ? 'bg-white/12 font-semibold' : 'text-warm/85 hover:bg-white/6')}
                >
                  <Icon aria-hidden className="size-4" />{label}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <p className="mt-auto px-2 text-xs leading-relaxed text-warm/55">Flechas mueven, R gira y Supr quita del plano.</p>
      </nav>

      <header className="col-span-2 flex items-center gap-6 border-b border-line bg-surface px-6">
        <div>
          <p className="text-sm text-muted">Bar Demo / {space.name}</p>
          <h1 className="text-2xl font-bold">Diseñar plano</h1>
        </div>
        <p className="text-sm" aria-live="polite">
          <span className={cn('font-semibold', ed.dirty ? 'text-fg' : 'text-muted')}>{ed.status}</span>
          <span className="block text-muted">{ed.publishedLine}</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={ed.discard} disabled={!ed.dirty}>Descartar</Button>
          <Button variant="secondary" onClick={ed.save} disabled={!ed.dirty || ed.saving}>Guardar borrador</Button>
          <Button onClick={ed.requestPublish}><Send aria-hidden className="size-4" />Publicar plano</Button>
        </div>
      </header>

      <main className="flex min-h-0 flex-col bg-sunken">
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <PlanCanvas ed={ed} />
        </div>
        <div className="flex h-12 items-center gap-4 border-t border-line bg-surface px-4 text-sm">
          <Zoom ed={ed} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={ed.snap} onChange={(e) => ed.setSnap(e.target.checked)} />Ajustar a la cuadrícula</label>
          <OverlapNote ed={ed} />
          <p className="ml-auto truncate text-muted" role="status">{ed.message}</p>
        </div>
      </main>

      <aside className="flex min-h-0 flex-col overflow-y-auto border-l border-line bg-surface">
        <section aria-labelledby="a-props" className="border-b border-line p-5">
          <h2 id="a-props" className="font-display text-lg font-bold">{el ? nameOf(el) : 'Propiedades'}</h2>
          {el ? (
            <>
              <p className="mb-4 text-sm text-muted">{el.type === 'table' ? 'Mesa real del local' : `${KIND[el.type]}, solo referencia visual`}</p>
              <Inspector ed={ed} />
            </>
          ) : <p className="mt-1 text-sm text-muted">Selecciona un elemento del plano para cambiar su forma, tamaño o giro.</p>}
        </section>
        <section aria-labelledby="a-tray" className="p-5">
          <h2 id="a-tray" ref={tray} tabIndex={-1} className="font-display text-lg font-bold outline-none">
            Mesas sin ubicar <span className="text-muted tabular-nums">({ed.unplaced.length})</span>
          </h2>
          <p className="mb-3 text-sm text-muted">Arrástralas al plano o toca Ubicar. Siguen recibiendo llamados aunque no estén en el plano.</p>
          <UnplacedTables ed={ed} />
        </section>
      </aside>
      <EditorDialogs ed={ed} />
      <ProtoBar ed={ed} />
    </div>
  );
}

/* ─────────────── B — Lienzo protagonista: chrome mínimo, herramientas flotantes, inspector plegable ─────────────── */

export function EditorB() {
  const ed = useLayoutEditor();
  const [drawer, setDrawer] = useState(false);
  const { space, el } = ed;

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="flex h-14 shrink-0 items-center gap-5 bg-ink px-4 text-warm">
        <Wordmark dark />
        <span className="text-sm text-warm/70">Bar Demo</span>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Espacio</span>
          <select value={ed.spaceId} onChange={(e) => ed.selectSpace(e.target.value)} className="h-9 rounded-md border border-white/20 bg-white/10 px-2 font-semibold text-warm [&>option]:text-fg">
            {ed.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={ed.addSpace} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-warm/75 hover:bg-white/10"><Plus aria-hidden className="size-4" />Zona</button>
        <p className="flex items-center gap-2 text-sm text-warm/80" aria-live="polite">
          {ed.dirty && <span aria-hidden className="size-2 rounded-full bg-amber" />}
          {ed.status}. {ed.publishedLine}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={ed.save} disabled={!ed.dirty || ed.saving}>Guardar borrador</Button>
          <Button size="sm" onClick={ed.requestPublish}><Send aria-hidden className="size-4" />Publicar plano</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 bg-sunken">
          <div className="absolute inset-0 overflow-auto pt-24 pr-8 pb-8 pl-28">
            <PlanCanvas ed={ed} />
          </div>

          <div role="toolbar" aria-label="Herramientas" aria-orientation="vertical" className="fixed top-1/2 left-4 z-10 flex -translate-y-1/2 flex-col gap-0.5 rounded-xl border border-line bg-surface p-1.5 shadow-md">
            {TOOLS.map(({ id, label, Icon }) => (
              <button
                key={id} type="button" title={label}
                aria-pressed={id === 'select' ? !el && !drawer : id === 'table' ? drawer : undefined}
                onClick={() => (id === 'select' ? (ed.setSelected(null), setDrawer(false)) : id === 'table' ? setDrawer(!drawer) : ed.addTool(id as AddTool))}
                className={cn('flex h-14 w-16 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium', (id === 'select' && !el && !drawer) || (id === 'table' && drawer) ? 'bg-ink text-warm' : 'hover:bg-sunken')}
              >
                <Icon aria-hidden className="size-5" />{label}
              </button>
            ))}
          </div>

          <div className="fixed top-[72px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-md" style={{ marginLeft: el ? -155 : 0 }}>
            <Zoom ed={ed} />
            <span aria-hidden className="mx-1 h-6 w-px bg-line" />
            <Button size="sm" variant={ed.snap ? 'secondary' : 'ghost'} aria-pressed={ed.snap} onClick={() => ed.setSnap(!ed.snap)}>Cuadrícula</Button>
            <span aria-hidden className="mx-1 h-6 w-px bg-line" />
            <Button size="sm" variant={drawer ? 'secondary' : 'ghost'} aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
              Mesas sin ubicar
              <span className={cn('rounded-full px-2 text-xs tabular-nums', ed.unplaced.length ? 'bg-amber text-ink' : 'bg-sunken')}>{ed.unplaced.length}</span>
            </Button>
          </div>

          {drawer && (
            <section aria-labelledby="b-tray" className="fixed top-[124px] left-1/2 z-20 w-80 -translate-x-1/2 rounded-lg border border-line bg-surface p-4 shadow-lg" style={{ marginLeft: el ? -155 : 0 }}>
              <div className="mb-2 flex items-center justify-between">
                <h2 id="b-tray" className="font-bold">Mesas sin ubicar en {space.name}</h2>
                <Button size="sm" variant="ghost" aria-label="Cerrar" onClick={() => setDrawer(false)}><X aria-hidden className="size-4" /></Button>
              </div>
              <p className="mb-3 text-xs text-muted">Arrástralas al plano o toca Ubicar.</p>
              <UnplacedTables ed={ed} autoFocus />
            </section>
          )}
        </main>

        {el && (
          <aside aria-labelledby="b-props" className="w-[310px] shrink-0 overflow-y-auto border-l border-line bg-surface p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 id="b-props" className="font-display text-lg font-bold">{nameOf(el)}</h2>
                <p className="text-sm text-muted">{el.type === 'table' ? 'Mesa real del local' : 'Referencia visual'}</p>
              </div>
              <Button size="sm" variant="ghost" aria-label="Cerrar propiedades" onClick={() => ed.setSelected(null)}><X aria-hidden className="size-4" /></Button>
            </div>
            <Inspector ed={ed} compact />
          </aside>
        )}
      </div>

      <footer className="flex h-10 shrink-0 items-center gap-4 border-t border-line bg-surface pr-32 pl-28 text-sm">
        <OverlapNote ed={ed} />
        <p className="truncate text-muted" role="status">{ed.message}</p>
        <p className="ml-auto text-xs text-muted">Flechas mueven, R gira, Supr quita</p>
      </footer>
      <EditorDialogs ed={ed} />
      <ProtoBar ed={ed} />
    </div>
  );
}

/* ─────────────── C — Guiada: Espacio → Distribución → Revisar ─────────────── */

const STEPS = ['Espacio', 'Distribución', 'Revisar'] as const;

function CheckRow({ ok, warn = false, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-done-fg" /> : <TriangleAlert aria-hidden className={cn('mt-0.5 size-4 shrink-0', warn ? 'text-pending' : 'text-danger')} />}
      <span><span className="sr-only">{ok ? 'Listo: ' : warn ? 'Aviso: ' : 'Falta: '}</span>{children}</span>
    </li>
  );
}

export function EditorC() {
  const ed = useLayoutEditor();
  const [step, setStep] = useState(2);
  const [start, setStart] = useState<'copy' | 'empty'>('copy');
  const { space, el } = ed;
  const tablesHere = ed.tables.filter((t) => t.spaceId === ed.spaceId);
  const count = (type: string) => space.elements.filter((e) => e.type === type).length;

  function next() {
    if (step === 1 && start === 'empty' && space.elements.length) ed.clearSpace();
    setStep(step + 1);
  }

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="flex h-[72px] shrink-0 items-center gap-8 border-b border-line bg-surface px-6">
        <div>
          <Wordmark />
          <p className="text-xs text-muted">Bar Demo, diseñar plano</p>
        </div>
        <ol aria-label="Pasos" className="flex items-center gap-2">
          {STEPS.map((name, i) => {
            const n = i + 1;
            return (
              <li key={name} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className={cn('h-px w-10', n <= step ? 'bg-ink' : 'bg-line')} />}
                <button type="button" aria-current={n === step ? 'step' : undefined} onClick={() => setStep(n)} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-sunken">
                  <span className={cn('grid size-7 place-items-center rounded-full text-sm font-bold', n === step ? 'bg-ink text-warm' : n < step ? 'bg-done text-done-fg' : 'border border-line-strong text-muted')}>
                    {n < step ? <Check aria-hidden className="size-4" /> : n}
                  </span>
                  <span className={n === step ? 'font-semibold' : 'text-muted'}>{name}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="ml-auto flex items-center gap-2">
          <p className="mr-2 text-right text-sm text-muted" aria-live="polite">{ed.status}<br />{ed.publishedLine}</p>
          <Button size="sm" variant="ghost" onClick={ed.save} disabled={!ed.dirty || ed.saving}>Guardar borrador</Button>
          {step > 1 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Atrás</Button>}
          {step < 3 && <Button onClick={next}>Siguiente</Button>}
        </div>
      </header>

      {step === 1 && (
        <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-10">
          <h1 className="text-2xl font-bold">¿Qué espacio vas a organizar?</h1>
          <p className="mb-6 text-muted">Cada espacio tiene su propio plano. El personal verá solo lo que publiques.</p>
          <ul className="space-y-2" role="radiogroup" aria-label="Espacio">
            {ed.spaces.map((s) => {
              const total = ed.tables.filter((t) => t.spaceId === s.id).length;
              const on = s.id === ed.spaceId;
              return (
                <li key={s.id}>
                  <button
                    type="button" role="radio" aria-checked={on} onClick={() => ed.selectSpace(s.id)}
                    className={cn('flex w-full items-center gap-4 rounded-lg border bg-surface px-4 py-3 text-left', on ? 'border-ink ring-2 ring-ink' : 'border-line hover:border-line-strong')}
                  >
                    <span className="flex-1">
                      <span className="block font-display text-lg font-bold">{s.name}</span>
                      <span className="text-sm text-muted">{total} mesas{on ? `, ${ed.unplaced.length} sin ubicar` : ''}</span>
                    </span>
                    {on && <span className="text-sm text-muted">{ed.publishedLine}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" onClick={ed.addSpace}><Plus aria-hidden className="size-4" />Crear zona</Button>
          <fieldset className="mt-8">
            <legend className="mb-2 font-bold">¿Desde dónde empiezas?</legend>
            {([['copy', 'Editar una copia del plano actual', 'Lo publicado no cambia hasta que publiques.'], ['empty', 'Empezar un plano vacío', 'Las mesas quedan en «Mesas sin ubicar»; ninguna se borra.']] as const).map(([v, title, hint]) => (
              <label key={v} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-sunken">
                <input type="radio" name="start" checked={start === v} onChange={() => setStart(v)} className="mt-1 size-4" />
                <span><span className="block font-medium">{title}</span><span className="text-sm text-muted">{hint}</span></span>
              </label>
            ))}
          </fieldset>
        </main>
      )}

      {step === 2 && (
        <div className="grid min-h-0 flex-1 grid-cols-[288px_minmax(0,1fr)_304px]">
          <aside className="space-y-6 overflow-y-auto border-r border-line bg-surface p-5">
            <section aria-labelledby="c-tables">
              <h2 id="c-tables" className="font-display text-lg font-bold">Mesas de {space.name}</h2>
              <p className="mb-3 text-sm text-muted">{tablesHere.length - ed.unplaced.length} de {tablesHere.length} en el plano. Arrastra o toca Ubicar.</p>
              <UnplacedTables ed={ed} />
            </section>
            <section aria-labelledby="c-refs" className="border-t border-line pt-5">
              <h2 id="c-refs" className="mb-1 font-display text-lg font-bold">Referencias del local</h2>
              <p className="mb-3 text-sm text-muted">Ayudan a ubicarse; no reciben llamados.</p>
              <div className="grid grid-cols-2 gap-2">
                {REFS.map(({ id, label, Icon }) => (
                  <button key={id} type="button" onClick={() => ed.addTool(id as AddTool)} className="flex h-11 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-sunken">
                    <Icon aria-hidden className="size-4" />{label}
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <main className="flex min-h-0 flex-col bg-sunken">
            <div className="min-h-0 flex-1 overflow-auto p-6">
              <PlanCanvas ed={ed} />
            </div>
            <div className="flex h-11 items-center gap-4 border-t border-line bg-surface px-4">
              <Zoom ed={ed} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ed.snap} onChange={(e) => ed.setSnap(e.target.checked)} />Cuadrícula</label>
              <p className="ml-auto truncate text-sm text-muted" role="status">{ed.message}</p>
            </div>
          </main>

          <aside className="overflow-y-auto border-l border-line bg-surface p-5">
            {el ? (
              <section aria-labelledby="c-props">
                <div className="mb-4 flex items-center justify-between">
                  <h2 id="c-props" className="font-display text-lg font-bold">{nameOf(el)}</h2>
                  <Button size="sm" variant="ghost" onClick={() => ed.setSelected(null)}>Listo</Button>
                </div>
                <Inspector ed={ed} compact />
              </section>
            ) : (
              <section aria-labelledby="c-todo">
                <h2 id="c-todo" className="mb-3 font-display text-lg font-bold">¿Qué falta?</h2>
                <ul className="space-y-2">
                  <CheckRow ok={ed.unplaced.length === 0} warn>{ed.unplaced.length ? `${ed.unplaced.length} mesas sin ubicar` : 'Todas las mesas están en el plano'}</CheckRow>
                  <CheckRow ok={ed.outside.length === 0}>{ed.outside.length ? `${ed.outside.length} elementos fuera del lienzo` : 'Todo dentro del lienzo'}</CheckRow>
                  <CheckRow ok={ed.hits.size === 0} warn>{ed.hits.size ? 'Hay elementos encimados (no impide publicar)' : 'Nada encimado'}</CheckRow>
                  <CheckRow ok={!ed.dirty} warn>{ed.dirty ? 'Cambios sin guardar' : 'Borrador guardado'}</CheckRow>
                </ul>
                <p className="mt-6 text-sm text-muted">Toca una mesa para cambiar su nombre o su forma. Arrástrala para moverla; el tirador de arriba la gira.</p>
              </section>
            )}
          </aside>
        </div>
      )}

      {step === 3 && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
          <main className="flex min-h-0 flex-col bg-sunken p-6">
            <p className="mb-3 text-sm text-muted">Vista previa del plano que verá el personal. Los llamados en vivo se ven en el tablero.</p>
            <div className="min-h-0 flex-1 overflow-auto"><PlanCanvas ed={ed} readOnly /></div>
          </main>
          <aside aria-labelledby="c-review" className="space-y-6 overflow-y-auto border-l border-line bg-surface p-6">
            <section>
              <h1 id="c-review" className="mb-3 text-xl font-bold">Revisar {space.name}</h1>
              <ul className="space-y-2">
                <CheckRow ok>Cada mesa aparece una sola vez</CheckRow>
                <CheckRow ok>Todas las mesas son de {space.name}</CheckRow>
                <CheckRow ok={ed.outside.length === 0}>{ed.outside.length ? 'Hay elementos fuera del lienzo: corrígelos en Distribución' : 'Todo dentro del lienzo'}</CheckRow>
                <CheckRow ok={ed.hits.size === 0} warn>{ed.hits.size ? 'Hay elementos encimados; se puede publicar' : 'Nada encimado'}</CheckRow>
                <CheckRow ok={ed.unplaced.length === 0} warn>{ed.unplaced.length ? `${ed.unplaced.length} mesas sin ubicar: sus llamados siguen llegando a la cola` : 'Todas las mesas ubicadas'}</CheckRow>
              </ul>
            </section>
            <section aria-labelledby="c-sum">
              <h2 id="c-sum" className="mb-2 font-bold">Contenido</h2>
              <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                {([['Mesas en el plano', count('table')], ['Mesas sin ubicar', ed.unplaced.length], ['Barras', count('bar')], ['Puertas', count('door')], ['Paredes', count('wall')], ['Etiquetas', count('label')]] as const).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold tabular-nums">{v}</dd></div>
                ))}
              </dl>
            </section>
            <p className="text-sm text-muted">
              Al publicar, el tablero del personal muestra este plano{ed.published ? ` y la versión ${ed.published} pasa al archivo` : ''}.
            </p>
            <Button size="lg" className="w-full" onClick={ed.requestPublish} disabled={ed.outside.length > 0}><Send aria-hidden className="size-5" />Publicar plano</Button>
          </aside>
        </div>
      )}
      <EditorDialogs ed={ed} />
      <ProtoBar ed={ed} />
    </div>
  );
}

/* ─────────────── Índice para la revisión ─────────────── */

const OPTIONS = [
  ['/_proto/l05-a', 'A — Estudio', 'Espacios y herramientas a la izquierda, plano al centro, propiedades y mesas sin ubicar siempre a la derecha.'],
  ['/_proto/l05-b', 'B — Lienzo protagonista', 'Casi todo es plano: herramientas flotantes, mesas sin ubicar en un cajón y propiedades solo al seleccionar.'],
  ['/_proto/l05-c', 'C — Guiada', 'Tres pasos: elegir espacio, distribuir y revisar antes de publicar. Pensada para el primer plano del local.'],
  ['/_proto/editor', 'D — Primer prototipo', 'Pestañas de espacio arriba, herramientas a la izquierda, propiedades y bandeja a la derecha.'],
] as const;

export function ProtoIndex() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-fg">
      <Wordmark />
      <h1 className="mt-6 text-3xl font-bold">Diseñar plano: alternativas</h1>
      <p className="mt-2 mb-8 text-muted">Las cuatro usan la misma escena (Bar Demo, Salón principal, 12 mesas con 2 sin ubicar) y el mismo comportamiento. Solo cambia cómo se organiza la pantalla.</p>
      <ul className="divide-y divide-line border-y border-line">
        {OPTIONS.map(([to, title, text]) => (
          <li key={to}>
            <Link to={to} className="block py-4 hover:bg-surface">
              <span className="block font-display text-xl font-bold">{title}</span>
              <span className="text-muted">{text}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-muted">Relacionado: <Link to="/_proto/tablero" className="text-link underline">tablero sobre el plano (L-06)</Link>.</p>
    </main>
  );
}
