import { Eye, Plus, Save, Send, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { EditorDialogs, Inspector, PlanCanvas, ProtoBar, TOOLS, UnplacedTables, nameOf, useLayoutEditor } from './editor-kit';

// [DISEÑO] L-05, alternativa D (primer prototipo): pestañas de espacio arriba, herramientas a la izquierda, propiedades y mesas sin ubicar a la derecha.

export default function Editor() {
  const ed = useLayoutEditor();
  const [preview, setPreview] = useState(false);
  const { space, el } = ed;

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-3">
        <div>
          <Link to="/_proto/tablero" className="text-sm text-link underline">Ir al tablero</Link>
          <h1 className="text-xl font-bold">Editor de espacios</h1>
        </div>
        <nav aria-label="Espacios" className="flex flex-wrap items-center gap-1">
          {ed.spaces.map((s) => (
            <button
              key={s.id} type="button" aria-current={s.id === ed.spaceId ? 'page' : undefined} onClick={() => ed.selectSpace(s.id)}
              className={cn('h-10 rounded-md px-3 text-sm font-semibold', s.id === ed.spaceId ? 'bg-ink text-warm' : 'text-muted hover:bg-sunken')}
            >
              {s.name}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={ed.addSpace}><Plus aria-hidden className="size-4" />Espacio</Button>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <p className="mr-2 text-sm text-muted" aria-live="polite">
            {ed.dirty ? <span className="font-semibold text-fg">{ed.status}</span> : ed.status}
            <br />
            {ed.publishedLine}
          </p>
          <Button size="sm" variant="ghost" onClick={ed.discard} disabled={!ed.dirty}>Descartar</Button>
          <Button size="sm" variant="secondary" onClick={ed.save} disabled={!ed.dirty || ed.saving}><Save aria-hidden className="size-4" />Guardar borrador</Button>
          <Button size="sm" onClick={ed.requestPublish}><Send aria-hidden className="size-4" />Publicar</Button>
        </div>
      </header>

      <div className="grid min-h-0 gap-0 lg:grid-cols-[88px_minmax(0,1fr)_320px]">
        <aside aria-label="Herramientas" className="flex gap-1 overflow-x-auto border-b border-line bg-surface p-2 lg:flex-col lg:border-r lg:border-b-0">
          {TOOLS.filter((t) => t.id !== 'select' && t.id !== 'table').map(({ id, label, Icon }) => (
            <button key={id} type="button" onClick={() => ed.addTool(id as 'wall')} disabled={preview} className="flex min-w-16 flex-col items-center gap-1 rounded-md p-2 text-xs font-medium hover:bg-sunken disabled:opacity-50">
              <Icon aria-hidden className="size-5" />
              {label}
            </button>
          ))}
        </aside>

        <section aria-label={`Lienzo de ${space.name}`} className="flex min-h-0 min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 text-sm">
            <label className="flex items-center gap-2">
              Nombre del espacio
              <input value={space.name} maxLength={60} onChange={(e) => ed.renameSpace(e.target.value)} className="h-9 rounded-md border border-line-strong bg-surface px-2" />
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ed.snap} onChange={(e) => ed.setSnap(e.target.checked)} className="size-4" />Ajustar a la cuadrícula</label>
            <Button size="sm" variant={preview ? 'primary' : 'ghost'} aria-pressed={preview} onClick={() => { setPreview(!preview); ed.setSelected(null); }}>
              <Eye aria-hidden className="size-4" />Previsualizar
            </Button>
            {ed.hits.size > 0 && !preview && (
              <span role="status" className="flex items-center gap-1.5 rounded-md bg-pending/25 px-2 py-1 font-medium" title="Se puede publicar igual; revisa que se lean bien.">
                <TriangleAlert aria-hidden className="size-4" /> Elementos encimados (borde punteado)
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label="Alejar" onClick={() => ed.setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut aria-hidden className="size-4" /></Button>
              <span className="w-12 text-center tabular-nums">{Math.round(ed.zoom * 100)} %</span>
              <Button size="sm" variant="ghost" aria-label="Acercar" onClick={() => ed.setZoom((z) => Math.min(2, z + 0.25))}><ZoomIn aria-hidden className="size-4" /></Button>
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-sunken p-4">
            <PlanCanvas ed={ed} readOnly={preview} />
          </div>
        </section>

        <aside className="space-y-6 overflow-y-auto border-t border-line bg-surface p-4 lg:border-t-0 lg:border-l">
          <section aria-labelledby="props">
            <h2 id="props" className="mb-3 text-base font-bold">{el ? nameOf(el) : 'Propiedades'}</h2>
            {el ? <Inspector ed={ed} /> : <p className="text-sm text-muted">Toca un elemento del plano para cambiar su forma, tamaño o giro.</p>}
          </section>
          <section aria-labelledby="unplaced">
            <h2 id="unplaced" className="mb-1 text-base font-bold">Mesas sin ubicar <span className="text-muted tabular-nums">({ed.unplaced.length})</span></h2>
            <p className="mb-3 text-sm text-muted">Siguen recibiendo llamados; solo no aparecen en el plano.</p>
            <UnplacedTables ed={ed} />
          </section>
          <p className="min-h-5 text-sm" role="status" aria-live="polite">{ed.message}</p>
        </aside>
      </div>
      <EditorDialogs ed={ed} />
      <ProtoBar ed={ed} />
    </div>
  );
}
