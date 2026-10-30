import type { MovementDto, ProductDto, Unit } from '@modivara/commerce-contracts';
import {
  newIdempotencyKey, stockErrorState, useAdjustToCount, useBalances, useCreateProduct, useMovements, useProducts, useReasons, useRegisterMovement, useStockLocations,
} from '@modivara/commerce-web';
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, Minus, Package, PackagePlus, Plus, Scale, X, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { dec, fmtQty, fmtSigned, fmtWhen, startOfDay } from './format';
import { Bone, EmptyState, ErrorState, Page, Segmented, useApp, useEscape, useToast } from './ui';

// F4-09 — inventario, versión «registro rápido» (PLAN-002): tipo, producto, cantidad y motivo a la vista; lo registrado hoy al lado.
// Cada envío lleva su `Idempotency-Key` (reintentar tras un error reenvía la misma). Saldos y movimientos del lugar de stock por defecto.

type Direction = MovementDto['direction'];
const DIR: Record<Direction, { label: string; verb: string; Icon: LucideIcon; mark: string }> = {
  in: { label: 'Entrada', verb: 'Registrar entrada', Icon: ArrowDownToLine, mark: 'text-series-in' },
  out: { label: 'Salida', verb: 'Registrar salida', Icon: ArrowUpFromLine, mark: 'text-series-out' },
  adjust: { label: 'Ajuste por conteo', verb: 'Ajustar al conteo', Icon: Scale, mark: 'text-muted' },
};
const DIR_OPTIONS = [['out', 'Salida'], ['in', 'Entrada'], ['adjust', 'Ajuste por conteo']] as const;
const UNITS: [Unit, string][] = [['bottle', 'Botellas'], ['unit', 'Unidades'], ['kg', 'Kilos'], ['g', 'Gramos'], ['l', 'Litros'], ['ml', 'Mililitros']];
const NO_CATEGORY = 'Sin categoría';
const step = (u: Unit) => (u === 'kg' || u === 'l' ? 0.5 : 1);
const MOVEMENTS_LIMIT = 100;

/* ---------- Estado compartido ---------- */

function useInventory() {
  const { me, location, can } = useApp();
  const l = location.id;
  const toast = useToast();
  const productsQ = useProducts(l);
  const placesQ = useStockLocations(l);
  const place = placesQ.data?.find((p) => p.is_default && p.active) ?? placesQ.data?.find((p) => p.active);
  const balancesQ = useBalances(l, { stockLocationId: place?.id });
  const movementsQ = useMovements(l, { stockLocationId: place?.id, limit: MOVEMENTS_LIMIT });
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
    me, toast, place, products, categories, reasonName, fresh,
    movements: movementsQ.data ?? [],
    canWrite: can('commerce.stock.write'), canCatalog: can('commerce.catalog.manage'),
    loading: productsQ.isPending || placesQ.isPending || balancesQ.isPending || reasonsQ.isPending,
    error: productsQ.isError || placesQ.isError || balancesQ.isError || reasonsQ.isError,
    retry: () => { void productsQ.refetch(); void placesQ.refetch(); void balancesQ.refetch(); void reasonsQ.refetch(); void movementsQ.refetch(); },
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
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const bal = inv.balance(product.id);
  const n = Number(qty);
  const diff = direction === 'adjust' && qty !== '' ? n - bal : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
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
          <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className={input}>
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
            {/* OPEN: la API de movimientos no trae el nombre de quien registró; se muestra «tú» o nada. */}
            <span className="truncate text-xs text-muted">{fmtWhen(m.occurred_at)}{m.actor_user_id === inv.me.actor.user_id ? ', tú' : ''}{m.note ? `. ${m.note}` : ''}</span>
            <span className="text-right text-xs text-muted tabular-nums">Saldo {fmtQty(m.balance_after, unit)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Historial reciente con filtros por producto y tipo. */
function HistoryView({ inv }: { inv: Inv }) {
  const [productId, setProductId] = useState('');
  const [dir, setDir] = useState<'' | Direction>('');
  const rows = inv.movements.filter((m) => (!productId || m.product_id === productId) && (!dir || m.direction === dir));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <select aria-label="Producto" value={productId} onChange={(e) => setProductId(e.target.value)} className={cn(input, 'w-auto')}>
          <option value="">Todos los productos</option>
          {inv.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Segmented label="Tipo" options={[['', 'Todos'], ['in', 'Entradas'], ['out', 'Salidas'], ['adjust', 'Ajustes']] as const} value={dir} onChange={setDir} />
      </div>
      <MovementList inv={inv} movements={rows} />
      {inv.movements.length >= MOVEMENTS_LIMIT && <p className="text-center text-sm text-muted">Se muestran los {MOVEMENTS_LIMIT} movimientos más recientes.</p>}
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
  useEscape(onClose);
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/30 p-4" onClick={onClose}>
      <form role="dialog" aria-modal aria-labelledby="new-product" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="anim-rise w-full max-w-md space-y-5 rounded-xl bg-surface p-6 shadow-2xl" noValidate>
        <div className="flex items-center justify-between">
          <h2 id="new-product" className="text-xl font-bold">Nuevo producto</h2>
          <Button variant="ghost" aria-label="Cerrar" onClick={onClose}><X aria-hidden className="size-5" /></Button>
        </div>
        <Field label="Nombre"><input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={120} className={input} /></Field>
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
    </div>
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
  const product = inv.product(chosen ?? '') ?? inv.products[0];
  const todayStart = startOfDay(new Date()).getTime();
  const today = inv.movements.filter((m) => Date.parse(m.occurred_at) >= todayStart);

  let body: ReactNode;
  if (inv.loading) {
    body = <div aria-busy aria-label="Cargando inventario" className="grid gap-6 p-4 md:p-8 lg:grid-cols-[minmax(0,1fr)_400px]"><div className="space-y-4"><Bone className="h-10 w-80" /><div className="grid grid-cols-3 gap-2">{Array.from({ length: 9 }, (_, i) => <Bone key={i} className="h-16" />)}</div><Bone className="h-12" /></div><RowBones n={6} /></div>;
  } else if (inv.error) {
    body = <ErrorState what="el inventario" onRetry={inv.retry} />;
  } else if (!product) {
    body = <EmptyState Icon={Package} title="Aún no hay productos" text="Crea los productos que controlas (botellas, insumos) y registra su stock inicial como una entrada."
      action={inv.canCatalog && <Button onClick={() => setCreating(true)}><PackagePlus aria-hidden className="size-4" />Crear el primer producto</Button>} />;
  } else {
    body = (
      <div className="anim-rise grid lg:min-h-[calc(100dvh-73px)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-labelledby="compose" className="p-4 md:p-8">
          <h2 id="compose" className="sr-only">Registrar movimiento</h2>
          {inv.canWrite && <div className="mb-6"><Segmented label="Tipo de movimiento" options={DIR_OPTIONS} value={direction} onChange={setDirection} /></div>}
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <p className="mb-2 text-sm font-semibold">Producto</p>
              <div className="space-y-3">
                {inv.categories.map((c) => (
                  <div key={c}>
                    <p className="mb-1.5 text-xs text-muted">{c}</p>
                    <div role="radiogroup" aria-label={c} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {inv.products.filter((p) => (p.category ?? NO_CATEGORY) === c).map((p) => {
                        const on = p.id === product.id;
                        return (
                          <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setChosen(p.id)}
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
                ? <MovementForm key={`${product.id}-${direction}`} inv={inv} product={product} direction={direction} />
                : <p className="text-muted">Saldo: <span className="font-semibold text-fg">{fmtQty(inv.balance(product.id), product.unit)}</span>. Tu rol solo permite consultar.</p>}
            </div>
          </div>
        </section>

        <aside aria-labelledby="feed" className="border-line bg-surface p-5 lg:border-l">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="feed" className="text-lg font-bold">{all ? 'Historial' : 'Hoy'}</h2>
            <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Ver solo hoy' : 'Ver historial'}</Button>
          </div>
          {all ? <HistoryView inv={inv} /> : today.length ? <MovementList inv={inv} movements={today} dense /> : <p className="py-8 text-center text-sm text-muted">Hoy no se ha registrado nada.</p>}
        </aside>
      </div>
    );
  }

  return (
    <Page id="inventario" title="Inventario" subtitle={inv.place ? `Lugar de stock ${inv.place.name}` : undefined}
      actions={inv.canCatalog && <div className="md:ml-auto"><Button variant="ghost" onClick={() => setCreating(true)}><PackagePlus aria-hidden className="size-4" />Nuevo producto</Button></div>}>
      {body}
      {creating && <ProductDialog inv={inv} onClose={() => setCreating(false)} onCreated={(p) => { setChosen(p.id); setDirection('in'); }} />}
      {inv.toast.node}
    </Page>
  );
}
