import type { MovementReasonDto } from '@modivara/commerce-contracts';
import { stockErrorState, useCreateReason, useCreateStockLocation, useDeactivateReason, useReasons, useStockLocations } from '@modivara/commerce-web';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Bone, ErrorState, useApp, useToast } from './ui';

// F4-10 — lugares de stock (por local) y motivos de movimiento (por negocio), dentro de Inventario.
// La API no renombra ni desactiva lugares, ni edita motivos: solo alta (y desactivar motivos).

type Direction = MovementReasonDto['direction'];
const GROUPS: [Direction, string][] = [['in', 'Entrada'], ['out', 'Salida'], ['adjust', 'Ajuste']];
const field = 'mt-1 block h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-fg';

/** Errores de la API en palabras del usuario (por estado derivado del código, nunca por el texto). */
function say(e: unknown, what: string): string {
  const s = stockErrorState(e);
  return s === 'conflict' ? `Ya existe ${what} con ese nombre.`
    : s === 'forbidden' ? 'Tu rol no permite hacer este cambio.'
    : s === 'validation' ? 'El servidor no aceptó el nombre. Revísalo (hasta 120 caracteres).'
    : s === 'not_found' ? 'Ya no existe: recarga la página.'
    : 'No se pudo guardar. Revisa la conexión e intenta de nuevo.';
}

function ConfirmDeactivate({ reason, onClose, onDone }: { reason: MovementReasonDto; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const deactivate = useDeactivateReason();
  const [error, setError] = useState('');
  useEffect(() => ref.current?.showModal(), []);
  async function go() {
    setError('');
    try { await deactivate.mutateAsync(reason.id); onDone(); } catch (e) { setError(say(e, 'el motivo')); }
  }
  return (
    <dialog ref={ref} aria-label={`Desactivar motivo ${reason.name}`} onClose={onClose} className="m-auto w-full max-w-md rounded-lg border border-line bg-surface p-6 text-fg shadow-xl backdrop:bg-ink/40">
      <h2 className="mb-2 text-lg font-bold">Desactivar «{reason.name}»</h2>
      <p className="mb-4 text-sm text-muted">Dejará de ofrecerse al registrar movimientos. Los movimientos ya registrados con este motivo se conservan.</p>
      {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" autoFocus onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="secondary" className="text-danger" disabled={deactivate.isPending} onClick={go}>Desactivar</Button>
      </div>
    </dialog>
  );
}

function Places({ canCreate }: { canCreate: boolean }) {
  const { location } = useApp();
  const toast = useToast();
  const q = useStockLocations(location.id);
  const create = useCreateStockLocation(location.id);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Escribe el nombre del lugar.');
    try {
      await create.mutateAsync({ name: name.trim() });
      toast.show(`Lugar «${name.trim()}» creado.`);
      setName(''); setError('');
    } catch (err) { setError(say(err, 'un lugar')); }
  }
  return (
    <section aria-labelledby="places" className="space-y-3">
      <h2 id="places" className="text-lg font-bold">Lugares de stock</h2>
      <p className="text-sm text-muted">De {location.name}. No se pueden renombrar ni quitar una vez creados.</p>
      {q.isPending ? <Bone className="h-12 w-full" /> : q.isError ? <ErrorState what="los lugares" onRetry={() => void q.refetch()} /> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {q.data.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <span className="font-semibold">{p.name}</span>
              <span className="text-muted">{[p.is_default && 'Por defecto', !p.active && 'Desactivado'].filter(Boolean).join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
          <label className="block flex-1 basis-56 text-sm text-muted">Nombre del lugar<input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={120} autoComplete="off" className={field} /></label>
          <Button type="submit" variant="secondary" disabled={create.isPending}>Agregar lugar</Button>
          {error && <p role="alert" className="basis-full text-sm text-danger">{error}</p>}
        </form>
      )}
      {toast.node}
    </section>
  );
}

function Reasons() {
  const toast = useToast();
  const q = useReasons();
  const create = useCreateReason();
  const [name, setName] = useState('');
  const [direction, setDirection] = useState<Direction>('out');
  const [error, setError] = useState('');
  const [target, setTarget] = useState<MovementReasonDto | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Escribe el nombre del motivo.');
    try {
      await create.mutateAsync({ name: name.trim(), direction });
      toast.show(`Motivo «${name.trim()}» creado.`);
      setName(''); setError('');
    } catch (err) { setError(say(err, 'un motivo')); }
  }
  return (
    <section aria-labelledby="reasons" className="space-y-3">
      <h2 id="reasons" className="text-lg font-bold">Motivos de movimiento</h2>
      <p className="text-sm text-muted">Valen para todo el negocio. Un motivo desactivado deja de ofrecerse al registrar.</p>
      {q.isPending ? <Bone className="h-24 w-full" /> : q.isError ? <ErrorState what="los motivos" onRetry={() => void q.refetch()} /> : (
        <div className="space-y-4">
          {GROUPS.map(([d, label]) => (
            <div key={d} role="group" aria-label={label}>
              <h3 className="mb-1.5 text-sm font-semibold text-muted">{label}</h3>
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {q.data.filter((r) => r.direction === d).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className={r.active ? 'font-semibold' : 'text-muted'}>{r.name}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-muted">{r.active ? 'Activo' : 'Desactivado'}</span>
                      {r.active && <Button size="sm" variant="ghost" className="text-danger" aria-label={`Desactivar ${r.name}`} onClick={() => setTarget(r)}>Desactivar</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
        <label className="block flex-1 basis-56 text-sm text-muted">Nombre del motivo<input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={120} autoComplete="off" className={field} /></label>
        <label className="block text-sm text-muted">Tipo
          <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)} className={field}>{GROUPS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select>
        </label>
        <Button type="submit" variant="secondary" disabled={create.isPending}>Agregar motivo</Button>
        <p className="basis-full text-xs text-muted">El tipo no se puede cambiar después.</p>
        {error && <p role="alert" className="basis-full text-sm text-danger">{error}</p>}
      </form>
      {target && <ConfirmDeactivate reason={target} onClose={() => setTarget(null)} onDone={() => { toast.show(`Motivo «${target.name}» desactivado.`); setTarget(null); }} />}
      {toast.node}
    </section>
  );
}

export default function InventorySettings() {
  const { can } = useApp();
  return (
    <div className="mx-auto max-w-2xl space-y-10 p-4 md:p-8">
      {can('commerce.stock.read') && <Places canCreate={can('commerce.catalog.manage')} />}
      {can('commerce.reasons.manage') && <Reasons />}
    </div>
  );
}
