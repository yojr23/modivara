import type { ServiceCallDto } from '@modivara/hospitality-contracts';
import { useCallDetail, useCallHistory, useConnectionStatus, useTables } from '@modivara/hospitality-web';
import { History as HistoryIcon, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/ui/Button';
import { StatusBadge, type CallStatus } from '@/ui/StatusBadge';
import { fmtSeconds, fmtWhen, startOfDay } from './format';
import { Bone, EmptyState, ErrorState, OfflineBanner, Page, useApp, useEscape } from './ui';

// F3-14 — historial de llamados: rango por días (atajos o fechas), mesa y estado; lista con cursor y detalle con la línea de tiempo.
// Permiso: `hospitality.calls.read` (el de la API de llamados).

const BADGE: Record<ServiceCallDto['status'], CallStatus> = { pending: 'pending', in_progress: 'attending', completed: 'done' };
const STATUS_OPTIONS = [['all', 'Todos'], ['pending', 'Pendiente'], ['in_progress', 'En atención'], ['completed', 'Atendida']] as const;
const ACTION: Record<string, string> = { create: 'Llegó el llamado', acknowledge: 'Pasó a «En atención»', complete: 'Finalizado' };
const COLS = 'md:grid-cols-[minmax(0,1.5fr)_1fr_.8fr_.9fr_1fr_1fr_.7fr_9rem]';
/** [texto, días atrás del «desde», días atrás del «hasta»]. */
const SHORTCUTS = [['Hoy', 0, 0], ['Ayer', 1, 1], ['7 días', 6, 0]] as const;

// ponytail: fechas en la zona del navegador (= la del local, como format.ts); usar `location.timezone` si difieren.
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayStart = (s: string, plus = 0) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d! + plus); };
const daysAgo = (n: number) => { const d = startOfDay(new Date()); d.setDate(d.getDate() - n); return ymd(d); };
const secs = (a: string | null, b: string) => (a ? (new Date(a).getTime() - new Date(b).getTime()) / 1000 : null);
const where = (c: ServiceCallDto) => { const [zone, ...rest] = c.table_display_name.split(' · '); return rest.length ? { label: rest.join(' · '), zone } : { label: zone!, zone: null }; };

function Detail({ locationId, call, onClose }: { locationId: string; call: ServiceCallDto; onClose: () => void }) {
  useEscape(onClose);
  const q = useCallDetail(locationId, call.id);
  const { label, zone } = where(call);
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-ink/40" onClick={onClose}>
      <aside role="dialog" aria-modal aria-label={`Detalle de ${label}`} onClick={(e) => e.stopPropagation()} className="anim-rise h-full w-full max-w-md space-y-6 overflow-y-auto bg-surface p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-bold">{label}</h2>
            {zone && <p className="text-sm text-muted">{zone}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-md text-muted hover:bg-sunken"><X aria-hidden className="size-5" /></button>
        </div>
        <StatusBadge status={BADGE[call.status]} />
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-muted">Llegó</dt><dd className="font-semibold">{fmtWhen(call.created_at)}</dd></div>
          <div><dt className="text-muted">Pulsaciones</dt><dd className="font-semibold tabular-nums">{call.press_count}</dd></div>
          <div><dt className="text-muted">Espera hasta «En atención»</dt><dd className="font-semibold">{fmtSeconds(secs(call.acknowledged_at, call.created_at))}</dd></div>
          <div><dt className="text-muted">Duración total</dt><dd className="font-semibold">{fmtSeconds(secs(call.completed_at, call.created_at))}</dd></div>
        </dl>
        <section aria-label="Línea de tiempo">
          <h3 className="mb-3 font-semibold">Línea de tiempo</h3>
          {q.isPending ? <div className="space-y-3"><Bone className="w-2/3" /><Bone className="w-1/2" /><Bone className="w-3/5" /></div>
            : q.isError ? <ErrorState what="el detalle" onRetry={() => void q.refetch()} error={q.error} />
            : (
              <ol className="space-y-4 border-l border-line pl-4">
                {q.data.transitions.map((t, i) => (
                  <li key={i} className="relative text-sm">
                    <span aria-hidden className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-line-strong" />
                    <p className="font-semibold">{ACTION[t.action] ?? t.action}</p>
                    <p className="text-muted">{fmtWhen(t.occurred_at)} · {t.actor_name ?? (t.action === 'create' ? 'Botón' : '—')}</p>
                  </li>
                ))}
              </ol>
            )}
        </section>
      </aside>
    </div>
  );
}

export default function History() {
  const { location } = useApp();
  const l = location.id;
  const [from, setFrom] = useState(daysAgo(0));
  const [to, setTo] = useState(daysAgo(0));
  const [tableId, setTableId] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number][0]>('all');
  const [open, setOpen] = useState<ServiceCallDto | null>(null);
  const conn = useConnectionStatus();
  const tables = useTables(l);
  const validRange = !!from && !!to && from <= to;
  // `from` inclusivo y `to` exclusivo: «hasta» es un día completo, así que el límite es el inicio del día siguiente.
  const h = useCallHistory(l, {
    status, ...(tableId && { table_id: tableId }),
    ...(validRange && { from: dayStart(from).toISOString(), to: dayStart(to, 1).toISOString() }),
  });
  const items = h.data?.pages.flatMap((p) => p.items) ?? [];
  const field = 'mt-1 block h-10 rounded-md border border-line-strong bg-surface px-2 text-sm text-fg';

  return (
    <Page id="historial" title="Historial" subtitle="Llamados del local">
      {conn === 'disconnected' && <OfflineBanner />}
      <div className="space-y-4 p-4 md:p-6">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()} aria-label="Filtros">
          <div role="group" aria-label="Atajos de fecha" className="flex gap-1">
            {SHORTCUTS.map(([text, a, b]) => <Button key={text} variant="secondary" size="sm" className="h-10" onClick={() => { setFrom(daysAgo(a)); setTo(daysAgo(b)); }}>{text}</Button>)}
          </div>
          <label className="text-sm text-muted">Desde<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
          <label className="text-sm text-muted">Hasta<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={field} /></label>
          <label className="text-sm text-muted">Mesa
            <select value={tableId} onChange={(e) => setTableId(e.target.value)} className={field}>
              <option value="">Todas</option>
              {(tables.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.zone_name ? `${t.zone_name} · ${t.label}` : t.label}</option>)}
            </select>
          </label>
          <label className="text-sm text-muted">Estado
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={field}>
              {STATUS_OPTIONS.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
            </select>
          </label>
        </form>

        {!validRange ? <EmptyState Icon={HistoryIcon} title="Elige un rango válido" text="La fecha «Desde» debe ser igual o anterior a «Hasta»." />
          : h.isPending ? <div role="status" aria-label="Cargando historial" className="space-y-4">{Array.from({ length: 6 }, (_, i) => <Bone key={i} className="h-12 w-full" />)}</div>
          : h.isError ? <ErrorState what="el historial" onRetry={() => void h.refetch()} error={h.error} />
          : items.length === 0 ? <EmptyState Icon={HistoryIcon} title="Sin llamados en este rango" text="Prueba con otro rango de fechas, otra mesa u otro estado." />
          : (
            <>
              <div aria-hidden className={`hidden gap-3 px-3 text-sm text-muted md:grid ${COLS}`}>
                <span>Mesa</span><span>Llegó</span><span>Espera</span><span>Duración</span><span>Tomó</span><span>Cerró</span><span>Pulsos</span><span>Estado</span>
              </div>
              <ul className="space-y-2 md:space-y-0 md:divide-y md:divide-line">
                {items.map((c) => {
                  const w = where(c);
                  return (
                    <li key={c.id}>
                      <button type="button" onClick={() => setOpen(c)} aria-label={`${w.label}, ${fmtWhen(c.created_at)}. Tomó ${c.acknowledged_by_name ?? 'nadie'}, cerró ${c.completed_by_name ?? 'nadie'}. Abrir detalle`} className={`grid w-full gap-x-3 gap-y-1 rounded-lg border border-line bg-surface p-3 text-left text-sm hover:bg-sunken md:items-center md:rounded-none md:border-0 md:bg-transparent ${COLS}`}>
                        <span><b className="block font-semibold">{w.label}</b>{w.zone && <span className="text-muted">{w.zone}</span>}</span>
                        <span>{fmtWhen(c.created_at)}</span>
                        <span><i className="not-italic text-muted md:hidden">Espera: </i>{fmtSeconds(secs(c.acknowledged_at, c.created_at))}</span>
                        <span><i className="not-italic text-muted md:hidden">Duración: </i>{fmtSeconds(secs(c.completed_at, c.created_at))}</span>
                        <span><i className="not-italic text-muted md:hidden">Tomó: </i>{c.acknowledged_by_name ?? '—'}</span>
                        <span><i className="not-italic text-muted md:hidden">Cerró: </i>{c.completed_by_name ?? '—'}</span>
                        <span className="tabular-nums"><i className="not-italic text-muted md:hidden">Pulsaciones: </i>{c.press_count}</span>
                        <span><StatusBadge status={BADGE[c.status]} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {h.hasNextPage && <div className="flex justify-center"><Button variant="secondary" disabled={h.isFetchingNextPage} onClick={() => void h.fetchNextPage()}>{h.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}</Button></div>}
            </>
          )}
      </div>
      {open && <Detail locationId={l} call={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}
