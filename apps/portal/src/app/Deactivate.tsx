import { errorState, useDeactivateTable, useDeactivateZone, useLayoutDraft, useSaveLayoutDraft } from '@modivara/hospitality-web';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/Button';
import type { Ed } from './editor-kit';
import { useApp } from './ui';

// S4: desactivar mesas y espacios (zonas). Acción secundaria, siempre con confirmación en un <dialog> nativo.

type Pending = { title: string; body: string; run: () => Promise<void>; conflict: string };

function Confirm({ p, onClose }: { p: Pending; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => ref.current?.showModal(), []);
  async function go() {
    setBusy(true);
    setError('');
    try {
      await p.run();
      onClose();
    } catch (e) {
      const s = errorState(e);
      setError(s === 'conflict' ? p.conflict : s === 'not_found' ? 'Ya no existe: recarga la página.' : s === 'forbidden' ? 'No tienes permiso para hacerlo.' : 'No se pudo desactivar. Intenta de nuevo.');
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} aria-labelledby="deact-title" onClose={onClose} className="m-auto w-full max-w-md rounded-lg border border-line bg-surface p-6 text-fg shadow-xl backdrop:bg-ink/40">
      <h2 id="deact-title" className="mb-2 text-lg font-bold">{p.title}</h2>
      <p className="mb-4 text-sm text-muted">{p.body}</p>
      {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" autoFocus onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="secondary" className="text-danger" disabled={busy} onClick={go}>Desactivar</Button>
      </div>
    </dialog>
  );
}

/** Desactivar mesas (y quitarlas del borrador del plano) y el espacio abierto. */
function useDeactivate(ed: Ed) {
  const l = useApp().location.id;
  const delTable = useDeactivateTable(l);
  const delZone = useDeactivateZone(l);
  const save = useSaveLayoutDraft(l);
  const draft = useLayoutDraft(l, ed.zoneId).data?.draft;
  const [pending, setPending] = useState<Pending | null>(null);
  const dialog = pending && <Confirm p={pending} onClose={() => setPending(null)} />;

  const table = (id: string) => {
    const label = ed.tableLabel.get(id) ?? 'La mesa';
    setPending({
      title: `Desactivar ${label}`,
      body: 'La mesa deja de aparecer en el editor y en el tablero. Sus llamados pasados se conservan en el historial.',
      conflict: `La mesa «${label}» tiene botones asignados o un llamado activo; libérala antes de desactivarla.`,
      run: async () => {
        await delTable.mutateAsync(id);
        // Un borrador con una mesa desactivada ya no se puede guardar ni publicar (400): se quita de él. Lo publicado la omite solo.
        if (draft?.elements.some((e) => e.type === 'table' && e.table_id === id)) {
          await save.mutateAsync({ zone_id: ed.zoneId, revision: draft.revision, canvas_width: draft.canvas_width, canvas_height: draft.canvas_height, elements: draft.elements.filter((e) => !(e.type === 'table' && e.table_id === id)) });
        }
      },
    });
  };
  const space = () => setPending({
    title: `Desactivar ${ed.space.name}`,
    body: 'El espacio deja de aparecer en el editor y en el tablero. Solo se puede si ya no tiene mesas activas.',
    conflict: 'El espacio tiene mesas activas: desactívalas o muévelas antes.',
    run: () => delZone.mutateAsync(ed.zoneId!),
  });
  return { table, space, dialog };
}

const DIRTY = 'Guarda o descarta los cambios del plano primero.';

/** Botón en el panel de la mesa seleccionada. Con cambios sin guardar se bloquea (el borrador cambiaría de revisión). */
export function DeactivateTable({ ed, tableId }: { ed: Ed; tableId: string }) {
  const d = useDeactivate(ed);
  return (
    <div className="mt-6 border-t border-line pt-4">
      <Button size="sm" variant="ghost" className="text-danger" disabled={ed.dirty} onClick={() => d.table(tableId)}>Desactivar mesa</Button>
      {ed.dirty && <p className="mt-1 text-xs text-muted">{DIRTY}</p>}
      {d.dialog}
    </div>
  );
}

/** Panel «¿Qué falta?»: desactivar cualquier mesa del espacio (también las sin ubicar) o el espacio entero. */
export function DeactivatePanel({ ed }: { ed: Ed }) {
  const d = useDeactivate(ed);
  const mine = ed.tables.filter((t) => t.spaceId === ed.spaceId);
  return (
    <details className="mt-6 border-t border-line pt-4 text-sm">
      <summary className="cursor-pointer font-semibold">Desactivar mesas o este espacio</summary>
      {ed.dirty && <p className="mt-2 text-xs text-muted">{DIRTY}</p>}
      <ul className="mt-2 space-y-1">
        {mine.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2">
            {t.label}
            <Button size="sm" variant="ghost" className="text-danger" disabled={ed.dirty} aria-label={`Desactivar ${t.label}`} onClick={() => d.table(t.id)}>Desactivar</Button>
          </li>
        ))}
        {mine.length === 0 && <li className="text-muted">No hay mesas activas en {ed.space.name}.</li>}
      </ul>
      {ed.zoneId && <Button size="sm" variant="ghost" className="mt-2 text-danger" onClick={d.space}>Desactivar espacio</Button>}
      {d.dialog}
    </details>
  );
}
