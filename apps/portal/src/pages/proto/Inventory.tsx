import type { MovementDto, ProductDto, Unit } from '@modivara/commerce-contracts';
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, Minus, Package, PackagePlus, Plus, Scale, X, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import {
  CATEGORIES, MOVEMENTS, PRODUCTS, REASONS, STOCK_LOCATION, USERS, balancesOf, dec, fmtQty, fmtSigned, fmtWhen, reasonById, userName,
} from './demo-data';
import { Bone, EmptyState, ErrorState, OfflineBanner, ProtoControls, ProtoShell, Segmented, useEscape, useToast, useViewState, type ViewState } from './shell';

// [DISEÑO] F4-09 — inventario: entrada/salida/ajuste por conteo, saldos e historial. Versión elegida (PLAN-002): «Registro rápido», con
// datos de demo de la forma de los DTO de commerce. Registrar se simula en memoria con las reglas de la API: cantidad > 0, saldo
// insuficiente (409 `insufficient_stock`) y conteo igual al saldo (delta 0, rechazado). Las alternativas A (tabla de saldos) y
// C (conteo de cierre) descartadas se pueden recuperar del commit 9835a72.


type Direction = MovementDto['direction'];
const DIR: Record<Direction, { label: string; verb: string; Icon: LucideIcon; mark: string }> = {
  in: { label: 'Entrada', verb: 'Registrar entrada', Icon: ArrowDownToLine, mark: 'text-series-in' },
  out: { label: 'Salida', verb: 'Registrar salida', Icon: ArrowUpFromLine, mark: 'text-series-out' },
  adjust: { label: 'Ajuste por conteo', verb: 'Ajustar al conteo', Icon: Scale, mark: 'text-muted' },
};
const DIR_OPTIONS = [['out', 'Salida'], ['in', 'Entrada'], ['adjust', 'Ajuste por conteo']] as const;
const UNITS: [Unit, string][] = [['bottle', 'Botellas'], ['unit', 'Unidades'], ['kg', 'Kilos'], ['g', 'Gramos'], ['l', 'Litros'], ['ml', 'Mililitros']];
const step = (u: Unit) => (u === 'kg' || u === 'l' ? 0.5 : 1);

/* ---------- Estado compartido ---------- */

function useInventory() {
  const view = useViewState();
  const toast = useToast();
  const [products, setProducts] = useState<ProductDto[]>(PRODUCTS);
  const [movements, setMovements] = useState<MovementDto[]>(MOVEMENTS);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const balances = balancesOf(movements);
  const offline = view.state === 'offline';

  function push(productId: string, direction: Direction, reasonId: string, delta: number, note: string | null) {
    const after = (balances.get(productId) ?? 0) + delta;
    const mv: MovementDto = {
      id: crypto.randomUUID(), stock_location_id: STOCK_LOCATION.id, product_id: productId, direction, reason_id: reasonId,
      delta: dec(delta), balance_after: dec(after), note, actor_user_id: USERS.inventario.id, occurred_at: new Date().toISOString(),
    };
    setMovements((all) => [mv, ...all]);
    setFresh((s) => new Set(s).add(mv.id));
    return mv;
  }

  return {
    view, toast, offline, products: view.state === 'empty' ? [] : products, movements: view.state === 'empty' ? [] : movements, balances, fresh,
    balance: (id: string) => balances.get(id) ?? 0,
    product: (id: string) => products.find((p) => p.id === id)!,
    /** Misma validación que la API; devuelve el error en palabras del usuario o null si se registró. */
    register(input: { productId: string; direction: Direction; reasonId: string; quantity: number; note: string }): string | null {
      const p = products.find((x) => x.id === input.productId)!;
      const bal = balances.get(p.id) ?? 0;
      if (offline) return 'Sin conexión: el movimiento no se envió. Tus datos siguen en el formulario.';
      if (!(input.quantity > 0) && input.direction !== 'adjust') return 'Escribe una cantidad mayor que cero.';
      if (input.direction === 'adjust') {
        if (!(input.quantity >= 0)) return 'Escribe la cantidad que contaste (puede ser 0).';
        const delta = input.quantity - bal;
        if (delta === 0) return `El conteo coincide con el saldo (${fmtQty(bal, p.unit)}): no hay nada que ajustar.`;
        push(p.id, 'adjust', input.reasonId, delta, input.note.trim() || null);
        toast.show(`${p.name} ajustado a ${fmtQty(input.quantity, p.unit)} (${fmtSigned(delta, p.unit)})`);
        return null;
      }
      if (input.direction === 'out' && input.quantity > bal) {
        return `No alcanza: hay ${fmtQty(bal, p.unit)} de ${p.name} y quieres sacar ${fmtQty(input.quantity, p.unit)}. Revisa la cantidad o registra primero la entrada.`;
      }
      const delta = input.direction === 'out' ? -input.quantity : input.quantity;
      push(p.id, input.direction, input.reasonId, delta, input.note.trim() || null);
      toast.show(`${DIR[input.direction].label} registrada: ${fmtSigned(delta, p.unit)} de ${p.name}. Saldo: ${fmtQty(bal + delta, p.unit)}`);
      return null;
    },
    createProduct(p: Omit<ProductDto, 'id' | 'active'>) {
      const np = { ...p, id: crypto.randomUUID(), active: true };
      setProducts((all) => [...all, np]);
      toast.show(`Producto creado: ${p.name}`);
      return np;
    },
  };
}
type Inv = ReturnType<typeof useInventory>;

const reasonsFor = (d: Direction) => REASONS.filter((r) => r.direction === d && r.active);
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
 * Formulario del producto y tipo elegidos arriba (la `key` lo reinicia al cambiarlos); la nota se agrega solo si hace falta. Durante el
 * envío el botón queda «Registrando…» (evita el doble toque; la API además deduplica por `Idempotency-Key`).
 */
function MovementForm({ inv, productId, direction }: { inv: Inv; productId: string; direction: Direction }) {
  const p = inv.product(productId);
  const [qty, setQty] = useState('');
  const [reasonId, setReasonId] = useState(reasonsFor(direction)[0]!.id);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const bal = inv.balance(p.id);
  const n = Number(qty);
  const diff = direction === 'adjust' && qty !== '' ? n - bal : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      const err = inv.register({ productId: p.id, direction, reasonId, quantity: qty === '' ? NaN : n, note });
      setBusy(false);
      setError(err);
      if (!err) { setQty(''); setNote(''); }
    }, 450);
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field
        label={direction === 'adjust' ? 'Cantidad contada' : 'Cantidad'}
        hint={direction === 'adjust'
          ? (diff === null ? `Cuenta lo que hay ahora. El sistema tiene ${fmtQty(bal, p.unit)}.` : diff === 0 ? 'Coincide con el saldo.' : `Diferencia con el saldo (${fmtQty(bal, p.unit)}): ${fmtSigned(diff, p.unit)}`)
          : `Saldo: ${fmtQty(bal, p.unit)}`}
      >
        <Quantity value={qty} onChange={(v) => { setQty(v); setError(null); }} unit={p.unit} label={direction === 'adjust' ? 'Cantidad contada' : 'Cantidad'} />
      </Field>
      {direction !== 'adjust' && (
        <Field label="Motivo">
          <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className={input}>
            {reasonsFor(direction).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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
      <Button type="submit" size="lg" className="w-full" disabled={busy || inv.offline}>
        {busy ? 'Registrando…' : direction === 'adjust' && qty !== '' ? `Ajustar a ${fmtQty(n, p.unit)}` : DIR[direction].verb}
      </Button>
      {inv.offline && <p className="text-sm text-muted">Sin conexión. Podrás registrar cuando vuelva.</p>}
    </form>
  );
}


/** Ícono de dirección + motivo («Venta», «Compra»): el motivo ya dice si entra o sale; la dirección va escrita para lectores. */
function DirTag({ d, reason }: { d: Direction; reason?: string }) {
  const { label, Icon, mark } = DIR[d];
  return <span className="inline-flex items-center gap-1.5 text-sm"><Icon aria-hidden className={cn('size-4', mark)} /><span className="sr-only">{label}:</span>{reason ?? label}</span>;
}

/** Historial de movimientos: lo nuevo entra con un leve desplazamiento; cantidades con signo y saldo resultante. */
function MovementList({ inv, limit, dense = false }: { inv: Inv; limit?: number; dense?: boolean }) {
  const rows = inv.movements.slice(0, limit);
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">Sin movimientos todavía.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((m) => {
        const p = inv.product(m.product_id);
        return (
          <li key={m.id} className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5', dense ? 'py-2.5' : 'py-3', inv.fresh.has(m.id) && 'anim-rise')}>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{p.name}</span>
              <span className="block text-muted"><DirTag d={m.direction} reason={reasonById.get(m.reason_id)?.name} /></span>
            </span>
            <span className="text-right font-semibold tabular-nums">{fmtSigned(m.delta, p.unit)}</span>
            <span className="truncate text-xs text-muted">{fmtWhen(m.occurred_at)}, {userName.get(m.actor_user_id) ?? 'Alguien'}{m.note ? `. ${m.note}` : ''}</span>
            <span className="text-right text-xs text-muted tabular-nums">Saldo {fmtQty(m.balance_after, p.unit)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Historial completo con filtros por producto y tipo. */
function HistoryView({ inv }: { inv: Inv }) {
  const [productId, setProductId] = useState('');
  const [dir, setDir] = useState<'' | Direction>('');
  const filtered = { ...inv, movements: inv.movements.filter((m) => (!productId || m.product_id === productId) && (!dir || m.direction === dir)) };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <select aria-label="Producto" value={productId} onChange={(e) => setProductId(e.target.value)} className={cn(input, 'w-auto')}>
          <option value="">Todos los productos</option>
          {inv.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Segmented label="Tipo" options={[['', 'Todos'], ['in', 'Entradas'], ['out', 'Salidas'], ['adjust', 'Ajustes']] as const} value={dir} onChange={setDir} />
      </div>
      <MovementList inv={filtered} limit={60} />
      {filtered.movements.length > 60 && <p className="text-center text-sm text-muted">Mostrando los 60 más recientes de {filtered.movements.length}.</p>}
    </div>
  );
}

/** Alta de producto: nombre, categoría, unidad (no se cambia después) y SKU opcional. */
function ProductDialog({ inv, onClose }: { inv: Inv; onClose: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [unit, setUnit] = useState<Unit>('bottle');
  const [sku, setSku] = useState('');
  const [error, setError] = useState('');
  useEscape(onClose);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Escribe el nombre del producto.');
    if (inv.products.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) return setError(`Ya existe un producto llamado «${name.trim()}».`);
    inv.createProduct({ name: name.trim(), category, unit, sku: sku.trim() || null });
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
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label="Unidad" hint="No se puede cambiar después.">
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={input}>{UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select>
          </Field>
        </div>
        <Field label="SKU (opcional)"><input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={64} className={input} /></Field>
        {error && <Problem text={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Crear producto</Button>
        </div>
      </form>
    </div>
  );
}

function Shell({ inv, children, actions }: { inv: Inv; children: ReactNode; actions?: ReactNode }) {
  return (
    <ProtoShell module="inventario" title="Inventario" subtitle={`Bar Demo, lugar ${STOCK_LOCATION.name}`} actions={actions && <div className="flex flex-wrap items-center gap-3 md:ml-auto">{actions}</div>}>
      {inv.view.state === 'offline' && <OfflineBanner />}
      {children}
      {inv.toast.node}
      <ProtoControls view={inv.view} />
    </ProtoShell>
  );
}

function Gate({ state, retry, empty, bones, children }: { state: ViewState; retry: () => void; empty: ReactNode; bones: ReactNode; children: ReactNode }) {
  if (state === 'loading') return <div aria-busy aria-label="Cargando inventario">{bones}</div>;
  if (state === 'error') return <ErrorState what="el inventario" onRetry={retry} />;
  if (state === 'empty') return <>{empty}</>;
  return <div className="anim-rise">{children}</div>;
}

const RowBones = ({ n = 8 }: { n?: number }) => (
  <div aria-hidden className="divide-y divide-line">{Array.from({ length: n }, (_, i) => <div key={i} className="flex items-center gap-6 py-4"><Bone className="w-2/5" /><Bone className="w-1/12" /><Bone className="ml-auto w-1/5" /></div>)}</div>
);
const NoProducts = ({ onCreate }: { onCreate: () => void }) => (
  <EmptyState Icon={Package} title="Aún no hay productos" text="Crea los productos que controlas (botellas, insumos) y registra su stock inicial como una entrada." action={<Button onClick={onCreate}><PackagePlus aria-hidden className="size-4" />Crear el primer producto</Button>} />
);

/* ---------- Registro rápido ---------- */

export default function Inventory() {
  const inv = useInventory();
  const [direction, setDirection] = useState<Direction>('out');
  const [productId, setProductId] = useState(PRODUCTS[0]!.id);
  const [creating, setCreating] = useState(false);
  const [all, setAll] = useState(false);
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const today = inv.movements.filter((m) => Date.parse(m.occurred_at) >= todayStart);

  return (
    <Shell inv={inv} actions={<Button variant="ghost" onClick={() => setCreating(true)}><PackagePlus aria-hidden className="size-4" />Nuevo producto</Button>}>
      <Gate state={inv.view.state} retry={inv.view.retry} empty={<NoProducts onCreate={() => setCreating(true)} />}
        bones={<div className="grid gap-6 p-4 md:p-8 lg:grid-cols-[minmax(0,1fr)_400px]"><div className="space-y-4"><Bone className="h-10 w-80" /><div className="grid grid-cols-3 gap-2">{Array.from({ length: 9 }, (_, i) => <Bone key={i} className="h-16" />)}</div><Bone className="h-12" /></div><RowBones n={6} /></div>}>
        <div className="grid lg:min-h-[calc(100dvh-73px)] lg:grid-cols-[minmax(0,1fr)_420px]">
          <section aria-labelledby="compose" className="p-4 md:p-8">
            <h2 id="compose" className="sr-only">Registrar movimiento</h2>
            <div className="mb-6"><Segmented label="Tipo de movimiento" options={DIR_OPTIONS} value={direction} onChange={setDirection} /></div>
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div>
            <p className="mb-2 text-sm font-semibold">Producto</p>
            <div className="space-y-3">
              {CATEGORIES.map((c) => (
                <div key={c}>
                  <p className="mb-1.5 text-xs text-muted">{c}</p>
                  <div role="radiogroup" aria-label={c} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {inv.products.filter((p) => p.category === c).map((p) => {
                      const on = p.id === productId;
                      return (
                        <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setProductId(p.id)}
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
              <p className="mb-3 font-display text-xl font-bold">{inv.product(productId).name}</p>
              <MovementForm key={`${productId}-${direction}`} inv={inv} productId={productId} direction={direction} />
            </div>
            </div>
          </section>

          <aside aria-labelledby="feed" className="border-line bg-surface p-5 lg:border-l">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="feed" className="text-lg font-bold">{all ? 'Historial' : 'Hoy'}</h2>
              <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Ver solo hoy' : 'Ver historial completo'}</Button>
            </div>
            {all ? <HistoryView inv={inv} /> : today.length ? <MovementList inv={{ ...inv, movements: today }} dense /> : <p className="py-8 text-center text-sm text-muted">Hoy no se ha registrado nada.</p>}
          </aside>
        </div>
      </Gate>
      {creating && <ProductDialog inv={inv} onClose={() => setCreating(false)} />}
    </Shell>
  );
}
