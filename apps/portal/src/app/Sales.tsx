import {
  MONEY_PATTERN, PAYMENT_METHODS, QUANTITY_PATTERN, QUANTITY_SCALE, UNITS, currencySchema, parseScaled,
  type PaymentMethod, type SaleDto, type SellableItemDto, type Unit,
} from '@modivara/pos-contracts';
import { useTables, useZones } from '@modivara/hospitality-web';
import {
  newIdempotencyKey, posErrorState, useAddSaleLine, useCompleteSale, useCreateSellableItem, useDeactivateSellableItem, useOpenLinkedSale, useOpenSale,
  usePosSettings, useSale, useSales, useSellableItems, useUpdatePosSettings, useUpdateSellableItem, useVoidSale, useVoidSaleLine,
} from '@modivara/pos-web';
import { CircleAlert, Plus, Receipt, ShoppingCart, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { fmtMoney, fmtWhen } from './format';
import { DEFAULT_SPACE_NAME } from './plan';
import { Bone, EmptyState, ErrorState, Modal, Page, Segmented, useApp, useToast } from './ui';

// POS-23/24 — Ventas: vender (catálogo + ticket abierto), catálogo de artículos con la moneda del local e historial.
// Genérico: vale igual para un producto, una bebida o una hora de servicio. La venta abierta va en `?venta=<id>` para enlazarla
// desde otras pantallas. Tiempo real = refetch al mutar y al volver el foco (PLAN-POS-001 §P5).

type Toast = ReturnType<typeof useToast>;
type View = 'vender' | 'mesas' | 'catalogo' | 'historial';

const UNIT_LABEL: Record<Unit, string> = { unit: 'Unidad', kg: 'Kilogramo (kg)', g: 'Gramo (g)', l: 'Litro (l)', ml: 'Mililitro (ml)', m: 'Metro (m)', h: 'Hora (h)' };
const UNIT_SHORT: Record<Unit, [string, string]> = { unit: ['unidad', 'unidades'], kg: ['kg', 'kg'], g: ['g', 'g'], l: ['l', 'l'], ml: ['ml', 'ml'], m: ['m', 'm'], h: ['h', 'h'] };
const PAY: Record<PaymentMethod, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };
const NO_CATEGORY = 'Sin categoría';
const NOTE = 'Cobro declarado: no procesa pagos ni emite factura.';
const qtyFmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });
const fmtQty = (q: string, unit: Unit) => `${qtyFmt.format(Number(q))} ${UNIT_SHORT[unit][Number(q) === 1 ? 0 : 1]}`;
const input = 'h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-base';
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Cantidad escrita («1,5») → decimal del contrato, o null si no vale para la unidad (solo `unit` exige enteros). */
function parseQty(text: string, unit: Unit): string | null {
  const q = text.trim().replace(',', '.');
  if (!(unit === 'unit' ? /^\d{1,9}$/ : QUANTITY_PATTERN).test(q)) return null;
  return parseScaled(q, QUANTITY_SCALE) > 0n ? q : null;
}

/** Una clave de idempotencia por intención: solo se reutiliza al reintentar el mismo intento que falló (no duplica). */
function useIntent() {
  const failed = useRef<{ intent: string; key: string } | null>(null);
  return async <T,>(intent: string, run: (key: string) => Promise<T>): Promise<T> => {
    const key = failed.current?.intent === intent ? failed.current.key : newIdempotencyKey();
    failed.current = null;
    try {
      return await run(key);
    } catch (e) {
      failed.current = { intent, key };
      throw e;
    }
  };
}

function errorText(e: unknown): string {
  switch (posErrorState(e)) {
    case 'empty_sale': return 'La venta no tiene artículos vigentes.';
    case 'currency_locked': return 'No se puede cambiar la moneda: hay artículos activos en otra moneda o ventas abiertas. Desactiva esos artículos o cierra las ventas y vuelve a intentar.';
    case 'currency_mismatch': return 'Ese artículo tiene otra moneda que la venta. Revisa la moneda del local en Catálogo.';
    case 'invalid_quantity': return 'La cantidad no vale para la unidad del artículo.';
    case 'inactive_entity': case 'not_found': return 'Ese artículo o la venta ya no están disponibles. Se actualizó la lista.';
    case 'idempotency_key_reused': return 'Esa acción ya se registró con otros datos. Revisa la venta antes de repetirla.';
    case 'forbidden': return 'Tu rol no permite hacer esto en este local.';
    case 'conflict': return 'Ya existe un artículo activo con ese nombre o SKU.';
    case 'validation': return 'El servidor rechazó los datos. Revísalos y vuelve a intentar.';
    case 'network': return 'Sin conexión. Vuelve a intentarlo: no se duplica.';
    default: return 'No se pudo completar. Vuelve a intentarlo: no se duplica.';
  }
}

function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-muted">{hint}</span>}
    </label>
  );
}

function Problem({ text, id }: { text: string; id?: string }) {
  return <p id={id} role="alert" className="anim-rise flex gap-2 rounded-md border border-danger/40 bg-danger/6 px-3 py-2.5 text-sm"><CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />{text}</p>;
}

const RowBones = ({ n = 6 }: { n?: number }) => (
  <div aria-hidden className="divide-y divide-line">{Array.from({ length: n }, (_, i) => <div key={i} className="flex items-center gap-6 py-4"><Bone className="w-2/5" /><Bone className="ml-auto w-1/5" /></div>)}</div>
);

/** Confirmación de una acción que no se deshace (anular venta, desactivar artículo). */
function Confirm({ title, body, action, onConfirm, onClose }: { title: string; body: string; action: string; onConfirm: () => Promise<string | null>; onClose: () => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function go() {
    setBusy(true);
    const err = await onConfirm();
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }
  return (
    <Modal labelledBy={id} onClose={onClose}>
      <h2 id={id} className="mb-2 text-lg font-bold">{title}</h2>
      <p className="mb-4 text-sm text-muted">{body}</p>
      {error && <div className="mb-4"><Problem text={error} /></div>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" autoFocus onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="secondary" className="text-danger" disabled={busy} onClick={() => void go()}>{action}</Button>
      </div>
    </Modal>
  );
}

/** Líneas de una venta; las anuladas quedan tachadas (auditoría) y fuera del total. */
function Lines({ sale, onVoid, busy }: { sale: SaleDto; onVoid?: (lineId: string, name: string) => void; busy?: boolean }) {
  if (!sale.lines.length) return <p className="py-6 text-center text-sm text-muted">Toca un artículo para agregarlo.</p>;
  return (
    <ul className="divide-y divide-line">
      {sale.lines.map((l) => (
        <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2.5">
          <span className={cn('min-w-0', l.voided_at && 'text-muted')}>
            <span className={cn('block truncate font-semibold', l.voided_at && 'line-through')}>{l.name}</span>
            <span className="block text-sm text-muted tabular-nums">{fmtQty(l.quantity, l.unit)} × {fmtMoney(l.unit_price, sale.currency)}{l.voided_at && ' · Anulada'}</span>
          </span>
          <span className={cn('font-semibold tabular-nums', l.voided_at && 'text-muted line-through')}>{fmtMoney(l.line_total, sale.currency)}</span>
          {onVoid && !l.voided_at
            ? <Button size="sm" variant="ghost" className="w-9 px-0" aria-label={`Anular ${l.name}`} disabled={busy} onClick={() => onVoid(l.id, l.name)}><X aria-hidden className="size-4" /></Button>
            : <span className="w-9" />}
        </li>
      ))}
    </ul>
  );
}

const SALE_GONE = 'Otra persona ya cerró o anuló esta venta. Se actualizó la lista.';

/**
 * POS-29/30 — composición del portal: abre la venta vinculada a una mesa de Hospitality o recupera la que ya tiene abierta.
 * POS solo ve un recurso externo validado por el host; la venta no toca el llamado ni al revés.
 */
export function useTableSale(toast: Toast, onSale: (saleId: string) => void, onGone?: () => void) {
  const { location } = useApp();
  const m = useOpenLinkedSale(location.id);
  const intent = useIntent();
  return {
    busy: m.isPending,
    async open(tableId: string) {
      try {
        const r = await intent(`link:${tableId}`, (k) => m.mutateAsync({ input: { provider: 'hospitality', resource_type: 'table', resource_id: tableId }, idempotencyKey: k }));
        onSale(r.sale.id);
      } catch (e) {
        const s = posErrorState(e);
        toast.show(s === 'not_found' ? 'Esa mesa ya no está disponible para vender.' : s === 'sale_not_open' ? SALE_GONE : errorText(e));
        if (s === 'not_found') onGone?.();
      }
    },
  };
}

const activeCount = (s: SaleDto) => s.lines.filter((l) => !l.voided_at).length;
const countLabel = (n: number) => `${n} ${n === 1 ? 'artículo' : 'artículos'}`;

/* ---------- Vender ---------- */

function Sell({ toast, goCatalog }: { toast: Toast; goCatalog?: () => void }) {
  const { location, can } = useApp();
  const l = location.id;
  const tz = location.timezone;
  const itemsQ = useSellableItems(l);
  const openQ = useSales(l, { status: 'open', limit: 50 });
  const [params, setParams] = useSearchParams();
  const saleId = params.get('venta');
  const saleQ = useSale(l, saleId);
  const sale = saleQ.data?.status === 'open' ? saleQ.data : undefined;
  // `?venta=` elegida pero aún sin resolver (cargando o con error): tocar un artículo no debe abrir otra venta suelta.
  const unresolved = !!saleId && !sale;
  const openM = useOpenSale(l);
  const addM = useAddSaleLine(l);
  const adding = useRef(false);
  const voidLineM = useVoidSaleLine(l);
  const completeM = useCompleteSale(l);
  const voidM = useVoidSale(l);
  const intent = useIntent();
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState('1');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [problem, setProblem] = useState<string | null>(null);
  const [qtyBad, setQtyBad] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);

  const select = (id: string | null) => {
    setProblem(null);
    setQtyBad(false);
    setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('venta', id); else n.delete('venta'); return n; }, { replace: true });
  };
  // Cerrada, anulada (aquí o en otro equipo) o inexistente: deja de ser la venta en curso.
  const gone = (saleQ.data && saleQ.data.status !== 'open') || posErrorState(saleQ.error) === 'not_found';
  useEffect(() => { if (gone) select(null); }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ejecuta una mutación con su clave por intención; un error queda en palabras del usuario (409 `sale_not_open` → aviso). */
  async function run<T>(name: string, fn: (key: string) => Promise<T>): Promise<T | undefined> {
    setProblem(null);
    setQtyBad(false);
    try {
      return await intent(name, fn);
    } catch (e) {
      if (posErrorState(e) === 'sale_not_open') toast.show(SALE_GONE);
      else setProblem(errorText(e));
      if (posErrorState(e) === 'not_found' || posErrorState(e) === 'inactive_entity') void itemsQ.refetch();
      return undefined;
    }
  }

  async function newSale() {
    const r = await run('open', (k) => openM.mutateAsync({ idempotencyKey: k }));
    if (r) select(r.sale.id);
    return r?.sale.id;
  }

  async function add(item: SellableItemDto) {
    const quantity = parseQty(qty, item.unit);
    if (!quantity) {
      setQtyBad(true);
      qtyRef.current?.focus();
      return setProblem(item.unit === 'unit'
        ? `${item.name} se vende por unidad: escribe una cantidad entera mayor que cero.`
        : 'Escribe una cantidad mayor que cero, con hasta 3 decimales.');
    }
    // Un tap mientras otro agrega se ignora: dos claves distintas serían dos líneas legítimas para la API (POS-18).
    if (unresolved || adding.current) return;
    adding.current = true;
    try {
      const id = sale?.id ?? (await newSale());
      if (!id) return;
      const r = await run(`add:${id}:${item.id}:${quantity}`, (k) => addM.mutateAsync({ saleId: id, input: { sellable_item_id: item.id, quantity }, idempotencyKey: k }));
      if (r) setQty('1');
    } finally {
      adding.current = false;
    }
  }

  async function complete() {
    if (!sale) return;
    const r = await run(`complete:${sale.id}:${method}`, (k) => completeM.mutateAsync({ saleId: sale.id, input: { payment_method: method }, idempotencyKey: k }));
    if (!r) return;
    select(null);
    setMethod('cash');
    toast.show(`Venta registrada (cobro declarado): ${fmtMoney(r.sale.total, r.sale.currency)} en ${PAY[method].toLowerCase()}.`);
  }

  if (itemsQ.isPending || openQ.isPending) {
    return <div aria-busy aria-label="Cargando ventas" className="grid gap-6 p-4 md:p-8 lg:grid-cols-[minmax(0,1fr)_400px]"><div className="space-y-4"><Bone className="h-11 w-80" /><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Array.from({ length: 9 }, (_, i) => <Bone key={i} className="h-16" />)}</div></div><RowBones /></div>;
  }
  if (itemsQ.isError || openQ.isError) {
    return <ErrorState what="las ventas" error={itemsQ.error ?? openQ.error} onRetry={() => { void itemsQ.refetch(); void openQ.refetch(); }} />;
  }

  const items = itemsQ.data.filter((i) => i.active);
  const q = norm(search.trim());
  const shown = q ? items.filter((i) => norm(i.name).includes(q) || norm(i.sku ?? '').includes(q)) : items;
  const categories = [...new Set(shown.map((i) => i.category ?? NO_CATEGORY))].sort((a, b) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b)));
  const open = openQ.data.pages.flat();
  const busy = openM.isPending || completeM.isPending || voidM.isPending;
  const canCharge = !!sale && activeCount(sale) > 0;

  return (
    <div className="anim-rise grid lg:h-[calc(100dvh-73px)] lg:grid-cols-[minmax(0,1fr)_400px]">
      <section aria-labelledby="catalog-h" className="p-4 md:p-8 lg:overflow-y-auto">
        <h2 id="catalog-h" className="sr-only">Artículos</h2>
        {!items.length ? (
          <EmptyState Icon={ShoppingCart} title="Aún no hay artículos"
            text={goCatalog ? 'Crea en Catálogo lo que vendes, con su unidad y su precio.' : 'Pide a quien administra el negocio que cree el catálogo de este local.'}
            action={goCatalog && <Button variant="secondary" onClick={goCatalog}>Ir al catálogo</Button>} />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-end gap-3">
              <Field label="Buscar" className="min-w-48 flex-1">
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o SKU" className={input} />
              </Field>
              <Field label="Cantidad" className="w-28">
                <input ref={qtyRef} inputMode="decimal" value={qty} aria-invalid={qtyBad && !!problem} aria-describedby={qtyBad && problem ? 'sell-problem' : undefined} onChange={(e) => { setQty(e.target.value); setProblem(null); }} className={cn(input, 'text-center font-semibold tabular-nums')} />
              </Field>
            </div>
            {!shown.length && <p className="py-6 text-center text-muted">Nada coincide con «{search.trim()}».</p>}
            <div className="space-y-4">
              {categories.map((c) => (
                <div key={c}>
                  <p className="mb-1.5 text-xs text-muted">{c}</p>
                  <div role="group" aria-label={c} className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {shown.filter((i) => (i.category ?? NO_CATEGORY) === c).map((i) => (
                      <button key={i.id} type="button" disabled={openM.isPending || addM.isPending || unresolved} onClick={() => void add(i)}
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-line-strong active:bg-sunken disabled:opacity-50">
                        <span className="block font-semibold">{i.name}</span>
                        <span className="text-sm text-muted tabular-nums">{fmtMoney(i.price, i.currency)}{i.unit !== 'unit' && ` / ${i.unit}`}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <aside aria-labelledby="ticket-h" className="border-t border-line bg-surface p-5 lg:flex lg:min-h-0 lg:flex-col lg:border-t-0 lg:border-l">
        <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
          <div>
            <h2 id="ticket-h" className="text-lg font-bold">Venta en curso</h2>
            {sale && <p className="flex min-w-0 text-sm text-muted">{sale.context_label && <span title={sale.context_label} className="truncate font-semibold text-fg">{sale.context_label} · </span>}<span className="shrink-0">Abierta {fmtWhen(sale.opened_at, tz)}</span></p>}
          </div>
          <Button size="sm" variant="ghost" disabled={busy || unresolved} onClick={() => void newSale()}><Plus aria-hidden className="size-4" />Nueva venta</Button>
        </div>
        {open.some((s) => s.id !== sale?.id) && (
          <div role="group" aria-label="Ventas abiertas" className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
            {open.map((s) => (
              <button key={s.id} type="button" aria-pressed={s.id === sale?.id} onClick={() => select(s.id)}
                className={cn('shrink-0 rounded-md border px-3 py-1.5 text-left text-sm', s.id === sale?.id ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong')}>
                <span className="block font-semibold tabular-nums">{fmtMoney(s.total, s.currency)}</span>
                <span title={s.context_label ?? undefined} className="block max-w-56 truncate text-xs text-muted">{s.context_label && `${s.context_label} · `}{fmtWhen(s.opened_at, tz)} · {countLabel(activeCount(s))}</span>
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sale ? <Lines sale={sale} busy={voidLineM.isPending} onVoid={(lineId, name) => void run(`void-line:${lineId}`, (k) => voidLineM.mutateAsync({ saleId: sale.id, lineId, idempotencyKey: k })).then((r) => r && toast.show(`${name} anulado de la venta.`))} />
            : saleId && saleQ.isError ? <ErrorState what="la venta" error={saleQ.error} onRetry={() => void saleQ.refetch()} />
            : saleId ? <RowBones n={3} />
            : <p className="py-8 text-center text-sm text-muted">Toca un artículo para empezar una venta.</p>}
        </div>
        {problem && <div className="mt-3 shrink-0"><Problem id="sell-problem" text={problem} /></div>}
        {sale && (
          <div className="mt-4 shrink-0 space-y-3 border-t border-line pt-4">
            <p className="flex items-baseline justify-between">
              <span className="font-semibold">Total</span>
              <span className="font-display text-2xl font-bold tabular-nums">{fmtMoney(sale.total, sale.currency)}</span>
            </p>
            <Field label="Medio de pago">
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={input}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAY[m]}</option>)}
              </select>
            </Field>
            <Button size="lg" className="w-full" disabled={!canCharge || busy} onClick={() => void complete()}>
              {completeM.isPending ? 'Cobrando…' : `Cobrar ${fmtMoney(sale.total, sale.currency)}`}
            </Button>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted">{NOTE}</p>
              {can('pos.sales.void') && <Button size="sm" variant="ghost" className="shrink-0 text-danger" disabled={busy} onClick={() => setConfirmVoid(true)}>Anular venta</Button>}
            </div>
          </div>
        )}
      </aside>
      {confirmVoid && sale && (
        <Confirm title="¿Anular esta venta?" body="Queda en el historial como anulada y no se puede deshacer." action="Anular venta" onClose={() => setConfirmVoid(false)}
          onConfirm={async () => {
            try {
              await intent(`void:${sale.id}`, (k) => voidM.mutateAsync({ saleId: sale.id, idempotencyKey: k }));
              select(null);
              toast.show('Venta anulada.');
              return null;
            } catch (e) {
              return posErrorState(e) === 'sale_not_open' ? 'Otra persona ya cerró o anuló esta venta.' : errorText(e);
            }
          }} />
      )}
    </div>
  );
}

/* ---------- Por mesa ---------- */

/** POS-30: las mesas activas del local como entrada a su venta; sirve en celular, sin plano publicado y sin llamado activo. */
function ByTable({ toast, onSale }: { toast: Toast; onSale: (saleId: string) => void }) {
  const { location } = useApp();
  const tablesQ = useTables(location.id);
  const zonesQ = useZones(location.id);
  const sale = useTableSale(toast, onSale, () => void tablesQ.refetch());
  if (tablesQ.isPending) return <div aria-busy aria-label="Cargando mesas" className="p-4 md:p-8"><RowBones /></div>;
  if (tablesQ.isError) return <ErrorState what="las mesas" error={tablesQ.error} onRetry={() => void tablesQ.refetch()} />;
  const tables = tablesQ.data;
  if (!tables.length) return <EmptyState title="Aún no hay mesas" text="Quien administra el local las crea en Espacios." />;
  // Orden del tablero: el espacio por defecto primero y luego los pisos por posición; dentro de cada uno, el orden de la API.
  const pos = new Map((zonesQ.data ?? []).map((z) => [z.id, z.position]));
  const name = (z: string | null) => tables.find((t) => t.zone_id === z)?.zone_name ?? DEFAULT_SPACE_NAME;
  const zones = [...new Set(tables.map((t) => t.zone_id))]
    .sort((a, b) => (a === null ? -1 : b === null ? 1 : (pos.get(a) ?? 0) - (pos.get(b) ?? 0) || name(a).localeCompare(name(b))));
  return (
    <div className="anim-rise mx-auto max-w-4xl space-y-4 p-4 md:p-8">
      <p className="text-sm text-muted">Toca una mesa para abrir su venta o seguir con la que ya tiene abierta.</p>
      {zones.map((z) => (
        <div key={z ?? ''}>
          <p className="mb-1.5 text-xs text-muted">{name(z)}</p>
          <div role="group" aria-label={name(z)} className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {tables.filter((t) => t.zone_id === z).map((t) => (
              <button key={t.id} type="button" aria-label={`${name(z)} · ${t.label}`} disabled={sale.busy} onClick={() => void sale.open(t.id)}
                className="rounded-lg border border-line bg-surface px-3 py-3 text-left font-semibold transition-colors hover:border-line-strong active:bg-sunken disabled:opacity-50">
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Catálogo ---------- */

function ItemDialog({ item, currency, categories, toast, onClose }: { item: SellableItemDto | null; currency?: string; categories: string[]; toast: Toast; onClose: () => void }) {
  const { location } = useApp();
  const createM = useCreateSellableItem(location.id);
  const updateM = useUpdateSellableItem(location.id);
  const [name, setName] = useState(item?.name ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [unit, setUnit] = useState<Unit>(item?.unit ?? 'unit');
  const [price, setPrice] = useState(item?.price.replace(/\.00$/, '') ?? '');
  const [error, setError] = useState('');
  const [bad, setBad] = useState<'name' | 'price' | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const title = useId();
  const errId = useId();
  const busy = createM.isPending || updateM.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = price.trim().replace(',', '.');
    const fail = (field: 'name' | 'price', ref: typeof nameRef, msg: string) => { setBad(field); setError(msg); ref.current?.focus(); };
    if (!name.trim()) return fail('name', nameRef, 'Escribe el nombre del artículo.');
    if (!MONEY_PATTERN.test(p)) return fail('price', priceRef, 'Escribe el precio sin separador de miles, con hasta 2 decimales (p. ej. 12000 o 12000,50).');
    try {
      const saved = item
        ? await updateM.mutateAsync({ itemId: item.id, input: { name: name.trim(), sku: sku.trim() || null, category: category.trim() || null, price: p } })
        : await createM.mutateAsync({ name: name.trim(), unit, price: p, ...(sku.trim() && { sku: sku.trim() }), ...(category.trim() && { category: category.trim() }) });
      toast.show(item ? `Artículo actualizado: ${saved.name}.` : `Artículo creado: ${saved.name}.`);
      onClose();
    } catch (err) {
      setBad(null);
      setError(errorText(err));
    }
  }

  return (
    <Modal labelledBy={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <h2 id={title} className="text-xl font-bold">{item ? 'Editar artículo' : 'Nuevo artículo'}</h2>
        <Field label="Nombre"><input ref={nameRef} value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={120} aria-invalid={error !== '' && bad === 'name'} aria-describedby={error && bad === 'name' ? errId : undefined} className={input} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Categoría (opcional)">
            <input list="pos-categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={120} className={input} />
            <datalist id="pos-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="SKU (opcional)"><input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={64} className={input} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Unidad" hint={item ? 'No se cambia después de crear.' : 'Solo «Unidad» exige cantidades enteras.'}>
            <select value={unit} disabled={!!item} onChange={(e) => setUnit(e.target.value as Unit)} className={cn(input, 'disabled:bg-sunken')}>
              {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select>
          </Field>
          <Field label={`Precio${(item?.currency ?? currency) ? ` (${item?.currency ?? currency})` : ''}`}>
            <input ref={priceRef} inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); setError(''); }} aria-invalid={error !== '' && bad === 'price'} aria-describedby={error && bad === 'price' ? errId : undefined} className={cn(input, 'tabular-nums')} />
          </Field>
        </div>
        {error && <Problem id={errId} text={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Guardando…' : item ? 'Guardar cambios' : 'Crear artículo'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function CurrencySetting({ toast }: { toast: Toast }) {
  const { location } = useApp();
  const q = usePosSettings(location.id);
  const m = useUpdatePosSettings(location.id);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState('');
  const current = value ?? q.data?.currency ?? '';
  const inputRef = useRef<HTMLInputElement>(null);
  const errId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!currencySchema.safeParse(current).success) { setError('Escribe el código de 3 letras de la moneda, p. ej. COP o USD.'); return inputRef.current?.focus(); }
    try {
      await m.mutateAsync({ currency: current });
      setValue(null);
      toast.show(`Moneda del local: ${current}.`);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section aria-labelledby="currency-h" className="max-w-md">
      <h2 id="currency-h" className="mb-1 text-lg font-bold">Moneda del local</h2>
      <p className="mb-3 text-sm text-muted">Una sola moneda por local, sin conversión. Solo cambia si no hay ventas abiertas ni artículos activos en otra moneda (solo monedas de 2 decimales).</p>
      {q.isPending ? <Bone className="h-11 w-48" /> : q.isError ? <ErrorState what="la moneda" error={q.error} onRetry={() => void q.refetch()} /> : (
        <form onSubmit={submit} className="flex gap-2" noValidate>
          <input ref={inputRef} aria-invalid={error !== ''} aria-describedby={error ? errId : undefined} aria-label="Moneda (código ISO 4217)" list="pos-currencies" value={current} maxLength={3} onChange={(e) => { setValue(e.target.value.toUpperCase()); setError(''); }} className={cn(input, 'w-28 uppercase')} />
          <datalist id="pos-currencies">{['COP', 'USD', 'EUR', 'MXN', 'PEN'].map((c) => <option key={c} value={c} />)}</datalist>
          <Button type="submit" variant="secondary" disabled={m.isPending || current === q.data.currency}>Guardar moneda</Button>
        </form>
      )}
      {error && <div className="mt-3"><Problem id={errId} text={error} /></div>}
    </section>
  );
}

function Catalog({ toast }: { toast: Toast }) {
  const { location } = useApp();
  const itemsQ = useSellableItems(location.id);
  const settingsQ = usePosSettings(location.id);
  const deactivateM = useDeactivateSellableItem(location.id);
  const [editing, setEditing] = useState<SellableItemDto | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<SellableItemDto | null>(null);
  const items = [...(itemsQ.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const categories = [...new Set(items.flatMap((i) => (i.category ? [i.category] : [])))].sort();

  return (
    <div className="anim-rise mx-auto max-w-4xl space-y-10 p-4 md:p-8">
      <section aria-labelledby="items-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="items-h" className="text-lg font-bold">Artículos</h2>
          <Button onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Nuevo artículo</Button>
        </div>
        {itemsQ.isPending ? <RowBones /> : itemsQ.isError ? <ErrorState what="el catálogo" error={itemsQ.error} onRetry={() => void itemsQ.refetch()} /> : !items.length ? (
          <EmptyState Icon={ShoppingCart} title="Aún no hay artículos" text="Agrega lo que vendes: productos o servicios, con su unidad y su precio." />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className={cn('min-w-0 flex-1', !i.active && 'text-muted')}>
                  <span className="block font-semibold">
                    {i.name}
                    {!i.active && <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium">Inactivo</span>}
                  </span>
                  <span className="block text-sm text-muted">{[i.category, i.sku && `SKU ${i.sku}`, UNIT_LABEL[i.unit]].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="font-semibold tabular-nums">{fmtMoney(i.price, i.currency)}</span>
                {i.active && (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Editar ${i.name}`} onClick={() => setEditing(i)}>Editar</Button>
                    <Button size="sm" variant="ghost" className="text-danger" aria-label={`Desactivar ${i.name}`} onClick={() => setDeactivating(i)}>Desactivar</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <CurrencySetting toast={toast} />
      {editing && <ItemDialog item={editing === 'new' ? null : editing} currency={settingsQ.data?.currency} categories={categories} toast={toast} onClose={() => setEditing(null)} />}
      {deactivating && (
        <Confirm title={`Desactivar ${deactivating.name}`} body="Deja de aparecer para vender. Las ventas ya registradas lo conservan." action="Desactivar"
          onClose={() => setDeactivating(null)}
          onConfirm={async () => {
            try {
              await deactivateM.mutateAsync(deactivating.id);
              toast.show(`${deactivating.name} desactivado.`);
              return null;
            } catch (e) {
              return errorText(e);
            }
          }} />
      )}
    </div>
  );
}

/* ---------- Historial ---------- */

function SaleDetail({ sale, onClose }: { sale: SaleDto; onClose: () => void }) {
  const { location } = useApp();
  const id = useId();
  return (
    <Modal labelledBy={id} onClose={onClose}>
      <h2 id={id} className="text-xl font-bold">Venta {fmtWhen(sale.closed_at ?? sale.opened_at, location.timezone)}</h2>
      <p className="mb-3 text-sm text-muted">{sale.status === 'voided' ? 'Anulada' : `Registrada · ${sale.payment_method ? PAY[sale.payment_method] : ''}`}</p>
      <div className="max-h-[50dvh] overflow-y-auto"><Lines sale={sale} /></div>
      <p className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
        <span className="font-semibold">Total</span>
        <span className="font-display text-xl font-bold tabular-nums">{fmtMoney(sale.total, sale.currency)}</span>
      </p>
      <p className="mt-2 text-xs text-muted">{NOTE}</p>
      <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Cerrar</Button></div>
    </Modal>
  );
}

function SalesHistory() {
  const { location } = useApp();
  const [status, setStatus] = useState<'completed' | 'voided'>('completed');
  const q = useSales(location.id, { status, limit: 50 });
  const [detail, setDetail] = useState<SaleDto | null>(null);
  const rows = q.data?.pages.flat() ?? [];
  return (
    <div className="anim-rise mx-auto max-w-4xl space-y-4 p-4 md:p-8">
      <Segmented label="Estado" options={[['completed', 'Registradas'], ['voided', 'Anuladas']] as const} value={status} onChange={setStatus} />
      {q.isPending ? <RowBones /> : q.isError ? <ErrorState what="el historial" error={q.error} onRetry={() => void q.refetch()} /> : !rows.length ? (
        <EmptyState Icon={Receipt} title={status === 'completed' ? 'Aún no hay ventas registradas' : 'No hay ventas anuladas'} text="Aquí aparecen las ventas cerradas de este local, de la más reciente a la más antigua." />
      ) : (
        <>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {rows.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setDetail(s)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-3 text-left hover:bg-sunken">
                  <span className="font-semibold">{fmtWhen(s.closed_at ?? s.opened_at, location.timezone)}</span>
                  <span className="text-right font-semibold tabular-nums">{fmtMoney(s.total, s.currency)}</span>
                  <span title={s.context_label ?? undefined} className="truncate text-sm text-muted">{s.context_label && `${s.context_label} · `}{countLabel(activeCount(s))}{s.payment_method && ` · ${PAY[s.payment_method]}`}</span>
                </button>
              </li>
            ))}
          </ul>
          {q.hasNextPage && <div className="text-center"><Button variant="secondary" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{q.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}</Button></div>}
        </>
      )}
      {detail && <SaleDetail sale={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

export default function Sales() {
  const { me, can } = useApp();
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const views = ([
    ['vender', 'Vender', can('pos.sales.operate')],
    // Composición: solo si el negocio tiene Hospitality (sin él /me no entrega hospitality.*) y el rol puede vincular ventas a mesas (caja y admin).
    ['mesas', 'Por mesa', can('pos.sales.operate') && me.modules.includes('hospitality') && can('hospitality.tables.link_sale')],
    ['catalogo', 'Catálogo', can('pos.catalog.manage')],
    ['historial', 'Historial', true],
  ] as [View, string, boolean][]).filter((v) => v[2]).map(([v, text]) => [v, text] as const);
  const [view, setView] = useState<View>(views[0]![0]);
  const goCatalog = can('pos.catalog.manage') ? () => setView('catalogo') : undefined;
  return (
    <Page id="ventas" title="Ventas"
      actions={views.length > 1 && <div className="md:ml-auto"><Segmented label="Vista" options={views} value={view} onChange={setView} /></div>}>
      {view === 'vender' ? <Sell toast={toast} goCatalog={goCatalog} />
        : view === 'mesas' ? <ByTable toast={toast} onSale={(id) => { setParams({ venta: id }, { replace: true }); setView('vender'); }} />
        : view === 'catalogo' ? <Catalog toast={toast} /> : <SalesHistory />}
      {toast.node}
    </Page>
  );
}
