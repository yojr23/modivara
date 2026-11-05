import type { MovementDto, ProductDto, Unit } from '@modivara/commerce-contracts';
import {
  newIdempotencyKey, stockErrorState, useAdjustToCount, useBalances, useCreateProduct, useMovementPages, useMovements, useProducts, useReasons, useRegisterMovement, useStockLocations,
} from '@modivara/commerce-web';
import { CircleAlert, CircleMinus, CirclePlus, Minus, Package, PackagePlus, Plus, Scale, type LucideIcon } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { dayKey, dayStart, dec, fmtQty, fmtSigned, fmtWhen } from './format';
import InventorySettings from './InventorySettings';
import { Bone, EmptyState, ErrorState, Modal, Page, Segmented, useApp, useToast } from './ui';

// F4-09 — inventario, versión «registro rápido» (PLAN-002): tipo, producto, cantidad y motivo a la vista; lo registrado hoy al lado.
// Cada envío lleva su `Idempotency-Key` (reintentar tras un error reenvía la misma). Saldos y movimientos del lugar de stock elegido
// (el por defecto si hay uno solo).

type Direction = MovementDto['direction'];
// Íconos de signo (+/−), no flechas: una flecha hacia arriba junto a «−3 botellas» se leía al revés.
const DIR: Record<Direction, { label: string; verb: string; Icon: LucideIcon; mark: string }> = {
  in: { label: 'Entrada', verb: 'Registrar entrada', Icon: CirclePlus, mark: 'text-series-in' },
  out: { label: 'Salida', verb: 'Registrar salida', Icon: CircleMinus, mark: 'text-series-out' },
  adjust: { label: 'Ajuste por conteo', verb: 'Ajustar al conteo', Icon: Scale, mark: 'text-muted' },
};
const DIR_OPTIONS = [['out', 'Salida'], ['in', 'Entrada'], ['adjust', 'Ajuste por conteo']] as const;
const UNITS: [Unit, string][] = [['bottle', 'Botellas'], ['unit', 'Unidades'], ['kg', 'Kilos'], ['g', 'Gramos'], ['l', 'Litros'], ['ml', 'Mililitros']];
const NO_CATEGORY = 'Sin categoría';
const step = (u: Unit) => (u === 'kg' || u === 'l' ? 0.5 : 1);
const TODAY_LIMIT = 200; // tope de la API; un día de un local no se acerca
const PAGE = 50;

/* ---------- Estado compartido ---------- */

function useInventory() {
  const { me, location, can } = useApp();
  const l = location.id;
  const toast = useToast();
  const productsQ = useProducts(l);
  const placesQ = useStockLocations(l);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const places = (placesQ.data ?? []).filter((p) => p.active);
  const place = places.find((p) => p.id === placeId) ?? places.find((p) => p.is_default) ?? places[0];
  const balancesQ = useBalances(l, { stockLocationId: place?.id });
  // «Hoy» es el día del local (DAT-07), no el del navegador.
  const tz = location.timezone;
  const todayQ = useMovements(l, { stockLocationId: place?.id, from: new Date(dayStart(dayKey(Date.now(), tz), tz)).toISOString(), limit: TODAY_LIMIT });
  const reasonsQ = useReasons();
  const registerM = useRegisterMovement(l);
  const adjustM = useAdjustToCount(l);
  const createM = useCreateProduct(l);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const products = (productsQ.data ?? []).filter((p) => p.active);
  const balances = new Map((balancesQ.data ?? []).map((b) => [b.product_id, Number(b.quantity)]));
  const reasonName = new Map((reasonsQ.data ?? []).map((r) => [r.id, r.name]));
  const categories = [...new Set(products.map((p) => p.category ?? NO_CATEGORY))].sort((a, b) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b)));

  return {
    me, tz, toast, place, places, setPlaceId, products, categories, reasonName, fresh,
    today: todayQ.data ?? [],
    canWrite: can('commerce.stock.write'), canCatalog: can('commerce.catalog.manage'),
    loading: productsQ.isPending || placesQ.isPending || balancesQ.isPending || reasonsQ.isPending,
    error: productsQ.error ?? placesQ.error ?? balancesQ.error ?? reasonsQ.error,
    retry: () => { void productsQ.refetch(); void placesQ.refetch(); void balancesQ.refetch(); void reasonsQ.refetch(); void todayQ.refetch(); },
    reasonsFor: (d: Direction) => (reasonsQ.data ?? []).filter((r) => r.direction === d && r.active),
    balance: (id: string) => balances.get(id) ?? 0,
    product: (id: string) => products.find((p) => p.id === id),
    busy: registerM.isPending || adjustM.isPending,
    /** Valida como la API y registra; devuelve el error en palabras del usuario o null si se registró. */
    async register(input: { productId: string; direction: Direction; reasonId: string; quantity: number; note: string; key: string }): Promise<string | null> {
      const p = products.find((x) => x.id === input.productId);
      if (!p || !place) return 'Elige un producto.';
      const bal = balances.get(p.id) ?? 0;
      const note = input.note.trim() || undefined;
      if (input.direction === 'adjust') {
        if (!(input.quantity >= 0)) return 'Escribe la cantidad que contaste (puede ser 0).';
        if (input.quantity === bal) return `El conteo coincide con el saldo (${fmtQty(bal, p.unit)}): no hay nada que ajustar.`;
      } else {
        if (!(input.quantity > 0)) return 'Escribe una cantidad mayor que cero.';
        if (input.direction === 'out' && input.quantity > bal) {
          return `No alcanza: hay ${fmtQty(bal, p.unit)} de ${p.name} y quieres sacar ${fmtQty(input.quantity, p.unit)}. Revisa la cantidad o registra primero la entrada.`;
        }
      }
      try {
        const { movement } = input.direction === 'adjust'
          ? await adjustM.mutateAsync({ input: { stock_location_id: place.id, product_id: p.id, reason_id: input.reasonId, counted_quantity: dec(input.quantity), note }, idempotencyKey: input.key })
          : await registerM.mutateAsync({ input: { stock_location_id: place.id, product_id: p.id, direction: input.direction, reason_id: input.reasonId, quantity: dec(input.quantity), note }, idempotencyKey: input.key });
        setFresh((s) => new Set(s).add(movement.id));
        toast.show(input.direction === 'adjust'
          ? `${p.name} ajustado a ${fmtQty(input.quantity, p.unit)} (${fmtSigned(movement.delta, p.unit)})`
          : `${DIR[input.direction].label} registrada: ${fmtSigned(movement.delta, p.unit)} de ${p.name}. Saldo: ${fmtQty(movement.balance_after, p.unit)}`);
        return null;
      } catch (e) {
        const s = stockErrorState(e);
        return s === 'insufficient_stock' ? `No alcanza el saldo de ${p.name}: alguien registró una salida antes. Revisa el saldo y vuelve a intentar.`
          : s === 'validation' ? 'El servidor rechazó la cantidad: usa hasta 3 decimales.'
          : s === 'forbidden' ? 'Tu rol no permite registrar movimientos en este local.'
          : 'No se pudo registrar. Revisa la conexión y vuelve a intentar (no se duplica).';
      }
    },
    async createProduct(p: { name: string; category: string; unit: Unit; sku: string }): Promise<ProductDto | string> {
      try {
        const created = await createM.mutateAsync({ name: p.name, unit: p.unit, ...(p.category && { category: p.category }), ...(p.sku && { sku: p.sku }) });
        toast.show(`Producto creado: ${created.name}. Registra su stock inicial como una entrada.`);
        return created;
      } catch (e) {
        return stockErrorState(e) === 'conflict' ? `Ya existe un producto llamado «${p.name}».` : 'No se pudo crear el producto.';
      }
    },
  };
}
type Inv = ReturnType<typeof useInventory>;

const input = 'h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-base';

function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-muted">{hint}</span>}
    </label>
  );
}

function Problem({ text }: { text: string }) {
  return <p role="alert" className="anim-rise flex gap-2 rounded-md border border-danger/40 bg-danger/6 px-3 py-2.5 text-sm"><CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />{text}</p>;
}

/** Cantidad con − y + del tamaño del dedo; el teclado numérico sigue funcionando. */
function Quantity({ value, onChange, unit, label }: { value: string; onChange: (v: string) => void; unit: Unit; label: string }) {
  const n = Number(value) || 0;
  const s = step(unit);
  return (
    <div className="flex items-stretch gap-2">
      <Button variant="secondary" aria-label="Menos" className="w-12 px-0" onClick={() => onChange(String(Math.max(0, n - s)))}><Minus aria-hidden className="size-4" /></Button>
      <div className="relative flex-1">
        <input aria-label={label} inputMode="decimal" type="number" min={0} step="any" value={value} onChange={(e) => onChange(e.target.value)} className={cn(input, 'pr-20 text-center font-display text-xl font-bold tabular-nums')} />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{unit === 'bottle' ? 'botellas' : unit === 'unit' ? 'unidades' : unit}</span>
      </div>
      <Button variant="secondary" aria-label="Más" className="w-12 px-0" onClick={() => onChange(String(n + s))}><Plus aria-hidden className="size-4" /></Button>
    </div>
  );
}

/**
 * Formulario del producto y tipo elegidos arriba (la `key` lo reinicia al cambiarlos); la nota se agrega solo si hace falta.
 * La clave de idempotencia se renueva solo tras un registro exitoso: un reintento tras un error no duplica el movimiento.
 */
function MovementForm({ inv, product, direction }: { inv: Inv; product: ProductDto; direction: Direction }) {
  const reasons = inv.reasonsFor(direction);
  const [qty, setQty] = useState('');
  // Sin motivo preelegido si hay de dónde elegir: aceptar el primero de la lista registraba motivos equivocados.
  // El ajuste no muestra selector (tiene un solo motivo, «Corrección de conteo»).
  const [reasonId, setReasonId] = useState(direction === 'adjust' || reasons.length === 1 ? reasons[0]?.id ?? '' : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const bal = inv.balance(product.id);
  const n = Number(qty);
  const diff = direction === 'adjust' && qty !== '' ? n - bal : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reasonId) return setError('Elige el motivo.');
    const err = await inv.register({ productId: product.id, direction, reasonId, quantity: qty === '' ? NaN : n, note, key });
    setError(err);
    if (!err) { setQty(''); setNote(''); setKey(newIdempotencyKey()); }
  }

  if (!reasons.length) return <Problem text="No hay motivos activos para este tipo de movimiento. Pide a quien administra que los cree." />;
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field
        label={direction === 'adjust' ? 'Cantidad contada' : 'Cantidad'}
        hint={direction === 'adjust'
          ? (diff === null ? `Cuenta lo que hay ahora. El sistema tiene ${fmtQty(bal, product.unit)}.` : diff === 0 ? 'Coincide con el saldo.' : `Diferencia con el saldo (${fmtQty(bal, product.unit)}): ${fmtSigned(diff, product.unit)}`)
          : `Saldo: ${fmtQty(bal, product.unit)}`}
      >
        <Quantity value={qty} onChange={(v) => { setQty(v); setError(null); }} unit={product.unit} label={direction === 'adjust' ? 'Cantidad contada' : 'Cantidad'} />
      </Field>
      {direction !== 'adjust' && (
        <Field label="Motivo">
          <select value={reasonId} onChange={(e) => { setReasonId(e.target.value); setError(null); }} className={input}>
            {!reasonId && <option value="" disabled>Elige el motivo</option>}
            {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      )}
      {!showNote && <Button size="sm" variant="ghost" className="-ml-3" onClick={() => setShowNote(true)}><Plus aria-hidden className="size-4" />Agregar nota</Button>}
      {showNote && (
        <Field label="Nota (opcional)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder={direction === 'out' ? 'Ej.: se rompió al servir' : ''} className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-base" />
        </Field>
      )}
      {error && <Problem text={error} />}
      <Button type="submit" size="lg" className="w-full" disabled={inv.busy}>
        {inv.busy ? 'Registrando…' : direction === 'adjust' && qty !== '' ? `Ajustar a ${fmtQty(n, product.unit)}` : DIR[direction].verb}
      </Button>
    </form>
  );
}

/** Ícono de dirección + motivo («Venta», «Compra»): el motivo ya dice si entra o sale; la dirección va escrita para lectores. */
function DirTag({ d, reason }: { d: Direction; reason?: string }) {
  const { label, Icon, mark } = DIR[d];
  return <span className="inline-flex items-center gap-1.5 text-sm"><Icon aria-hidden className={cn('size-4', mark)} /><span className="sr-only">{label}:</span>{reason ?? label}</span>;
}

/** Historial de movimientos: lo nuevo entra con un leve desplazamiento; cantidades con signo y saldo resultante. */
function MovementList({ inv, movements, dense = false }: { inv: Inv; movements: MovementDto[]; dense?: boolean }) {
  if (!movements.length) return <p className="py-6 text-center text-sm text-muted">Sin movimientos todavía.</p>;
  return (
    <ul className="divide-y divide-line">
      {movements.map((m) => {
        const p = inv.product(m.product_id);
        const unit = p?.unit ?? 'unit';
        return (
          <li key={m.id} className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5', dense ? 'py-2.5' : 'py-3', inv.fresh.has(m.id) && 'anim-rise')}>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{p?.name ?? 'Producto desactivado'}</span>
              <span className="block text-muted"><DirTag d={m.direction} reason={inv.reasonName.get(m.reason_id)} /></span>
            </span>
            <span className="text-right font-semibold tabular-nums">{fmtSigned(m.delta, unit)}</span>
            <span className="truncate text-xs text-muted">{fmtWhen(m.occurred_at, inv.tz)}{m.actor_user_id === inv.me.actor.user_id ? ', tú' : m.actor_name ? `, ${m.actor_name}` : ''}{m.note ? `. ${m.note}` : ''}</span>
            <span className="text-right text-xs text-muted tabular-nums">Saldo {fmtQty(m.balance_after, unit)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Historial completo: filtros por producto, tipo y fechas (día del local) en el servidor; «Cargar más» sigue el cursor. */
function HistoryView({ inv }: { inv: Inv }) {
  const { location } = useApp();
  const [productId, setProductId] = useState('');
  const [dir, setDir] = useState<'' | Direction>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const day = (d: string, plus = 0) => new Date(dayStart(d, inv.tz) + plus).toISOString();
  const q = useMovementPages(location.id, {
    stockLocationId: inv.place?.id, limit: PAGE,
    ...(productId && { productId }), ...(dir && { direction: dir }),
    ...(from && { from: day(from) }),
    ...(to && { to: day(dayKey(dayStart(to, inv.tz) + 36 * 3_600_000, inv.tz)) }), // «hasta» incluye ese día: el límite es el inicio del siguiente
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <select aria-label="Producto" value={productId} onChange={(e) => setProductId(e.target.value)} className={cn(input, 'w-auto')}>
          <option value="">Todos los productos</option>
          {inv.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Segmented label="Tipo" options={[['', 'Todos'], ['in', 'Entradas'], ['out', 'Salidas'], ['adjust', 'Ajustes']] as const} value={dir} onChange={setDir} />
        <Field label="Desde" className="w-auto"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={cn(input, 'w-auto')} /></Field>
        <Field label="Hasta" className="w-auto"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={cn(input, 'w-auto')} /></Field>
      </div>
      <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto">
        {q.isPending ? <RowBones n={5} /> : q.isError ? <ErrorState what="el historial" onRetry={() => void q.refetch()} error={q.error} /> : (
          <>
            <MovementList inv={inv} movements={rows} />
            {q.hasNextPage && <div className="text-center"><Button variant="secondary" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{q.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}</Button></div>}
          </>
        )}
      </div>
    </div>
  );
}

/** Alta de producto: nombre, categoría (lista abierta), unidad (no se cambia después) y SKU opcional. */
function ProductDialog({ inv, onClose, onCreated }: { inv: Inv; onClose: () => void; onCreated: (p: ProductDto) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState<Unit>('bottle');
  const [sku, setSku] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const title = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Escribe el nombre del producto.');
    setBusy(true);
    const r = await inv.createProduct({ name: name.trim(), category: category.trim(), unit, sku: sku.trim() });
    setBusy(false);
    if (typeof r === 'string') return setError(r);
    onCreated(r);
    onClose();
  }
  return (
    <Modal labelledBy={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <h2 id={title} className="text-xl font-bold">Nuevo producto</h2>
        <Field label="Nombre"><input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={120} className={input} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Categoría">
            <input list="categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={120} placeholder="Licores" className={input} />
            <datalist id="categories">{inv.categories.filter((c) => c !== NO_CATEGORY).map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Unidad" hint="No se puede cambiar después.">
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={input}>{UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select>
          </Field>
        </div>
        <Field label="SKU (opcional)"><input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={64} className={input} /></Field>
        {error && <Problem text={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear producto'}</Button>
        </div>
      </form>
    </Modal>
  );
}

const RowBones = ({ n = 8 }: { n?: number }) => (
  <div aria-hidden className="divide-y divide-line">{Array.from({ length: n }, (_, i) => <div key={i} className="flex items-center gap-6 py-4"><Bone className="w-2/5" /><Bone className="w-1/12" /><Bone className="ml-auto w-1/5" /></div>)}</div>
);

export default function Inventory() {
  const inv = useInventory();
  const [direction, setDirection] = useState<Direction>('out');
  const [chosen, setChosen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [all, setAll] = useState(false);
  const [view, setView] = useState<'registro' | 'ajustes'>('registro');
  const { can } = useApp();
  const canSettings = can('commerce.reasons.manage') || can('commerce.catalog.manage');
  const product = inv.product(chosen ?? '') ?? inv.products[0];
  const { today } = inv;

  let body: ReactNode;
  if (view === 'ajustes') {
    body = <InventorySettings />;
  } else if (inv.loading) {
    body = <div aria-busy aria-label="Cargando inventario" className="grid gap-6 p-4 md:p-8 lg:grid-cols-[minmax(0,1fr)_400px]"><div className="space-y-4"><Bone className="h-10 w-80" /><div className="grid grid-cols-3 gap-2">{Array.from({ length: 9 }, (_, i) => <Bone key={i} className="h-16" />)}</div><Bone className="h-12" /></div><RowBones n={6} /></div>;
  } else if (inv.error) {
    body = <ErrorState what="el inventario" onRetry={inv.retry} error={inv.error} />;
  } else if (!product) {
    body = <EmptyState Icon={Package} title="Aún no hay productos" text="Crea los productos que controlas (botellas, insumos) y registra su stock inicial como una entrada."
      action={inv.canCatalog && <Button onClick={() => setCreating(true)}><PackagePlus aria-hidden className="size-4" />Crear el primer producto</Button>} />;
  } else {
    body = (
      <div className="anim-rise grid lg:h-[calc(100dvh-73px)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-labelledby="compose" className="relative p-4 md:p-8 lg:overflow-y-auto">
          <h2 id="compose" className="sr-only">Registrar movimiento</h2>
          {inv.canWrite && <div className="mb-6"><Segmented label="Tipo de movimiento" options={DIR_OPTIONS} value={direction} onChange={setDirection} /></div>}
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <p className="mb-2 text-sm font-semibold">Producto</p>
              <div className="space-y-3">
                {inv.categories.map((c) => (
                  <div key={c}>
                    <p className="mb-1.5 text-xs text-muted">{c}</p>
                    <div role="group" aria-label={c} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {inv.products.filter((p) => (p.category ?? NO_CATEGORY) === c).map((p) => {
                        const on = p.id === product.id;
                        return (
                          <button key={p.id} type="button" aria-pressed={on} onClick={() => setChosen(p.id)}
                            className={cn('rounded-lg border bg-surface px-3 py-2 text-left transition-colors', on ? 'border-ink ring-2 ring-ink' : 'border-line hover:border-line-strong')}>
                            <span className="block font-semibold">{p.name}</span>
                            <span className="text-sm text-muted tabular-nums">{fmtQty(inv.balance(p.id), p.unit)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="max-w-md xl:sticky xl:top-6 xl:self-start">
              <p className="mb-3 font-display text-xl font-bold">{product.name}</p>
              {inv.canWrite
                ? <MovementForm key={`${inv.place?.id}-${product.id}-${direction}`} inv={inv} product={product} direction={direction} />
                : <p className="text-muted">Saldo: <span className="font-semibold text-fg">{fmtQty(inv.balance(product.id), product.unit)}</span>. Tu rol solo permite consultar.</p>}
            </div>
          </div>
        </section>

        {/* En pantallas anchas cada columna se desplaza sola: el historial largo no aleja el registro (auditoría V03). */}
        <aside aria-labelledby="feed" className="border-line bg-surface p-5 lg:flex lg:min-h-0 lg:flex-col lg:border-l">
          <div className="mb-2 flex shrink-0 items-baseline justify-between">
            <h2 id="feed" className="text-lg font-bold">{all ? 'Historial' : 'Hoy'}</h2>
            <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Ver solo hoy' : 'Ver historial'}</Button>
          </div>
          {all ? <HistoryView inv={inv} /> : (
            <div className="relative min-h-0 flex-1 overflow-y-auto">
              {today.length ? <MovementList inv={inv} movements={today} dense /> : <p className="py-8 text-center text-sm text-muted">Hoy no se ha registrado nada.</p>}
            </div>
          )}
        </aside>
      </div>
    );
  }

  return (
    <Page id="inventario" title="Inventario"
      subtitle={inv.places.length > 1 && view === 'registro'
        ? <select aria-label="Lugar de stock" value={inv.place?.id} onChange={(e) => inv.setPlaceId(e.target.value)} className="-ml-1 rounded bg-transparent px-1 font-semibold text-fg">
          {inv.places.map((p) => <option key={p.id} value={p.id}>Lugar de stock {p.name}</option>)}
        </select>
        : inv.place ? `Lugar de stock ${inv.place.name}` : undefined}
      actions={(canSettings || inv.canCatalog) && (
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          {canSettings && <Segmented label="Vista" options={[['registro', 'Registro'], ['ajustes', can('commerce.reasons.manage') ? 'Lugares y motivos' : 'Lugares de stock']] as const} value={view} onChange={setView} />}
          {inv.canCatalog && view === 'registro' && <Button variant="ghost" onClick={() => setCreating(true)}><PackagePlus aria-hidden className="size-4" />Nuevo producto</Button>}
        </div>
      )}>
      {body}
      {creating && <ProductDialog inv={inv} onClose={() => setCreating(false)} onCreated={(p) => { setChosen(p.id); setDirection('in'); }} />}
      {inv.toast.node}
    </Page>
  );
}
