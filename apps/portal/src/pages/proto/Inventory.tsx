import type { MovementDto, ProductDto, Unit } from '@modivara/commerce-contracts';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, CircleAlert, History, Minus, Package, PackagePlus, Plus, Scale, Search, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import {
  CATEGORIES, MOVEMENTS, PRODUCTS, REASONS, STOCK_LOCATION, USERS, balancesOf, dec, fmtQty, fmtSigned, fmtWhen, reasonById, userName,
} from './demo-data';
import { Bone, EmptyState, ErrorState, OfflineBanner, ProtoControls, ProtoShell, Segmented, useAlt, useToast, useViewState, type ViewState } from './shell';

// [DISEÑO] F4-09 — inventario: catálogo y saldos, entrada/salida/ajuste por conteo, historial (PLAN-002). Tres alternativas con datos
// de demo de la forma de los DTO de commerce. Registrar se simula en memoria con las reglas de la API: cantidad > 0, saldo insuficiente
// (409 `insufficient_stock`) y conteo igual al saldo (delta 0, rechazado).

const ALTS = { a: 'Tabla de saldos', b: 'Registro rápido', c: 'Conteo de cierre' };
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
  const [params] = useSearchParams();
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
    initialTab: params.get('tab'),
    /** `?abrir` en la URL: abre un producto al entrar (para revisar el panel sin clics). */
    openFirst: params.has('abrir'),
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
 * Formulario de movimiento común a las tres alternativas. Con `productId` fijo no muestra el selector. Durante el envío el botón
 * queda «Registrando…» (evita el doble toque; la API además deduplica por `Idempotency-Key`).
 */
function MovementForm({ inv, productId: fixed, onDone, direction: initialDir = 'out', compact = false, lockDirection = false }: {
  inv: Inv; productId?: string; onDone?: () => void; direction?: Direction; compact?: boolean; lockDirection?: boolean;
}) {
  const [direction, setDirection] = useState<Direction>(initialDir);
  const [productId, setProductId] = useState(fixed ?? inv.products[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [reasonId, setReasonId] = useState(reasonsFor(initialDir)[0]!.id);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNote, setShowNote] = useState(false);
  useEffect(() => { if (fixed) setProductId(fixed); }, [fixed]);
  const p = inv.products.find((x) => x.id === productId);
  if (!p) return null;
  const bal = inv.balance(p.id);
  const n = Number(qty);
  const diff = direction === 'adjust' && qty !== '' ? n - bal : null;

  function changeDir(d: Direction) {
    setDirection(d);
    setReasonId(reasonsFor(d)[0]!.id);
    setError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      const err = inv.register({ productId: p!.id, direction, reasonId, quantity: qty === '' ? NaN : n, note });
      setBusy(false);
      setError(err);
      if (!err) { setQty(''); setNote(''); onDone?.(); }
    }, 450);
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {!lockDirection && <Segmented label="Tipo de movimiento" options={DIR_OPTIONS} value={direction} onChange={changeDir} />}
      {!fixed && (
        <Field label="Producto" hint={`Saldo en ${STOCK_LOCATION.name}: ${fmtQty(bal, p.unit)}`}>
          <select value={productId} onChange={(e) => { setProductId(e.target.value); setError(null); }} className={input}>
            {CATEGORIES.map((c) => (
              <optgroup key={c} label={c}>{inv.products.filter((x) => x.category === c).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
            ))}
            {inv.products.some((x) => !x.category || !CATEGORIES.includes(x.category)) && (
              <optgroup label="Otros">{inv.products.filter((x) => !x.category || !CATEGORIES.includes(x.category)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
            )}
          </select>
        </Field>
      )}
      <Field
        label={direction === 'adjust' ? 'Cantidad contada' : 'Cantidad'}
        hint={direction === 'adjust'
          ? (diff === null ? `Cuenta lo que hay ahora. El sistema tiene ${fmtQty(bal, p.unit)}.` : diff === 0 ? 'Coincide con el saldo.' : `Diferencia con el saldo (${fmtQty(bal, p.unit)}): ${fmtSigned(diff, p.unit)}`)
          : fixed ? `Saldo: ${fmtQty(bal, p.unit)}` : undefined}
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
      {compact && !showNote && <Button size="sm" variant="ghost" className="-ml-3" onClick={() => setShowNote(true)}><Plus aria-hidden className="size-4" />Agregar nota</Button>}
      {(!compact || showNote) && (
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
function MovementList({ inv, productId, limit, showProduct = true, dense = false }: { inv: Inv; productId?: string; limit?: number; showProduct?: boolean; dense?: boolean }) {
  const rows = inv.movements.filter((m) => !productId || m.product_id === productId).slice(0, limit);
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">Sin movimientos todavía.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((m) => {
        const p = inv.product(m.product_id);
        return (
          <li key={m.id} className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5', dense ? 'py-2.5' : 'py-3', inv.fresh.has(m.id) && 'anim-rise')}>
            <span className="min-w-0">
              {showProduct && <span className="block truncate font-semibold">{p.name}</span>}
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
      <ProtoControls screen="inventario" alts={ALTS} view={inv.view} />
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
  <div aria-hidden className="divide-y divide-line">{Array.from({ length: n }, (_, i) => <div key={i} className="flex items-center gap-6 py-4"><Bone className="w-40" /><Bone className="w-16" /><Bone className="ml-auto w-24" /></div>)}</div>
);
const NoProducts = ({ onCreate }: { onCreate: () => void }) => (
  <EmptyState Icon={Package} title="Aún no hay productos" text="Crea los productos que controlas (botellas, insumos) y registra su stock inicial como una entrada." action={<Button onClick={onCreate}><PackagePlus aria-hidden className="size-4" />Crear el primer producto</Button>} />
);

/* ---------- A · Tabla de saldos ---------- */

function InventoryA() {
  const inv = useInventory();
  const [tab, setTab] = useState<'stock' | 'history'>(inv.initialTab === 'history' ? 'history' : 'stock');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(inv.openFirst ? PRODUCTS[2]!.id : null);
  const [creating, setCreating] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = inv.products.filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
  const last = (id: string) => inv.movements.find((m) => m.product_id === id);
  const sel = open ? inv.product(open) : null;

  return (
    <Shell inv={inv} actions={<>
      <Segmented label="Vista" options={[['stock', 'Saldos'], ['history', 'Historial']] as const} value={tab} onChange={setTab} />
      <Button variant="secondary" onClick={() => setCreating(true)}><PackagePlus aria-hidden className="size-4" />Nuevo producto</Button>
    </>}>
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <Gate state={inv.view.state} retry={inv.view.retry} empty={<NoProducts onCreate={() => setCreating(true)} />} bones={<RowBones />}>
          {tab === 'history' ? <HistoryView inv={inv} /> : (
            <>
              <label className="relative mb-6 block max-w-sm">
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o SKU" aria-label="Buscar producto" className={cn(input, 'pl-9')} />
              </label>
              {shown.length === 0 && <p className="py-10 text-center text-muted">Ningún producto coincide con «{query}».</p>}
              {[...CATEGORIES, null].map((c) => {
                const rows = shown.filter((p) => (c ? p.category === c : !p.category || !CATEGORIES.includes(p.category)));
                if (!rows.length) return null;
                return (
                  <section key={c ?? 'otros'} aria-labelledby={`cat-${c}`} className="mb-8">
                    <h2 id={`cat-${c}`} className="mb-1 text-sm font-semibold text-muted">{c ?? 'Otros'}</h2>
                    {/* Anchos fijos: las columnas quedan alineadas entre categorías. */}
                    <table className="w-full table-fixed text-left">
                      <colgroup><col /><col className="w-36" /><col className="hidden w-56 md:table-column" /><col className="w-28" /></colgroup>
                      <thead className="sr-only"><tr><th>Producto</th><th>Saldo</th><th>Último movimiento</th><th>Acción</th></tr></thead>
                      <tbody className="divide-y divide-line border-y border-line">
                        {rows.map((p) => {
                          const lm = last(p.id);
                          return (
                            <tr key={p.id} className={cn('group cursor-pointer hover:bg-surface', open === p.id && 'bg-surface')} onClick={() => setOpen(p.id)}>
                              <td className="py-3 pr-4"><span className="font-semibold">{p.name}</span><span className="block text-xs text-muted">{p.sku ?? 'Sin SKU'}</span></td>
                              <td className="py-3 pr-4 text-right font-display text-lg font-bold tabular-nums">{fmtQty(inv.balance(p.id), p.unit)}</td>
                              <td className="hidden py-3 pl-4 text-sm text-muted md:table-cell">{lm ? <>{reasonById.get(lm.reason_id)?.name} {fmtSigned(lm.delta, p.unit)}<span className="block text-xs">{fmtWhen(lm.occurred_at)}</span></> : 'Sin movimientos'}</td>
                              <td className="py-3 text-right"><Button size="sm" variant="ghost" className="opacity-70 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); setOpen(p.id); }}>Registrar</Button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                );
              })}
            </>
          )}
        </Gate>
      </div>

      {sel && (
        <div className="fixed inset-0 z-30 flex justify-end bg-ink/20" onClick={() => setOpen(null)}>
          <aside role="dialog" aria-modal aria-labelledby="product-panel" onClick={(e) => e.stopPropagation()} className="anim-slide flex h-full w-[min(440px,100vw)] flex-col overflow-y-auto bg-surface shadow-2xl">
            <div className="flex items-start gap-3 border-b border-line p-5">
              <div className="flex-1">
                <p className="text-sm text-muted">{sel.category}{sel.sku ? `, ${sel.sku}` : ''}</p>
                <h2 id="product-panel" className="font-display text-2xl font-bold">{sel.name}</h2>
                <p className="mt-2 font-display text-4xl font-extrabold tabular-nums">{fmtQty(inv.balance(sel.id), sel.unit)}</p>
                <p className="text-sm text-muted">Saldo en {STOCK_LOCATION.name}</p>
              </div>
              <Button variant="ghost" aria-label="Cerrar" onClick={() => setOpen(null)}><X aria-hidden className="size-5" /></Button>
            </div>
            <div className="border-b border-line p-5"><MovementForm key={sel.id} inv={inv} productId={sel.id} /></div>
            <div className="p-5">
              <h3 className="mb-1 flex items-center gap-2 font-bold"><History aria-hidden className="size-4 text-muted" />Historial</h3>
              <MovementList inv={inv} productId={sel.id} limit={12} showProduct={false} dense />
            </div>
          </aside>
        </div>
      )}
      {creating && <ProductDialog inv={inv} onClose={() => setCreating(false)} />}
    </Shell>
  );
}

/* ---------- B · Registro rápido ---------- */

function InventoryB() {
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
              <MovementForm key={`${productId}-${direction}`} inv={inv} productId={productId} direction={direction} lockDirection compact />
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

/* ---------- C · Conteo de cierre ---------- */

function InventoryC() {
  const inv = useInventory();
  const [tab, setTab] = useState<'count' | 'history'>(inv.initialTab === 'history' ? 'history' : 'count');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState('');
  const [moving, setMoving] = useState(false);
  const [creating, setCreating] = useState(false);
  const counted = inv.products.filter((p) => counts[p.id] !== undefined && counts[p.id] !== '');
  const changes = counted.map((p) => ({ p, diff: Number(counts[p.id]) - inv.balance(p.id) })).filter((x) => x.diff !== 0);
  const reason = REASONS.find((r) => r.direction === 'adjust')!;
  const progress = inv.products.length ? counted.length / inv.products.length : 0;

  function apply() {
    for (const { p } of changes) inv.register({ productId: p.id, direction: 'adjust', reasonId: reason.id, quantity: Number(counts[p.id]), note: note || 'Conteo de cierre' });
    inv.toast.show(`${changes.length} ${changes.length === 1 ? 'ajuste aplicado' : 'ajustes aplicados'}. Los demás productos coincidieron.`);
    setCounts({});
    setNote('');
    setReviewing(false);
  }

  return (
    <Shell inv={inv} actions={<>
      <Segmented label="Vista" options={[['count', 'Conteo'], ['history', 'Historial']] as const} value={tab} onChange={setTab} />
      <Button variant="secondary" onClick={() => setMoving(true)}><ArrowDownToLine aria-hidden className="size-4" />Entrada o salida</Button>
    </>}>
      <div className="mx-auto max-w-4xl p-4 pb-32 md:p-8 md:pb-32">
        <Gate state={inv.view.state} retry={inv.view.retry} empty={<NoProducts onCreate={() => setCreating(true)} />} bones={<RowBones n={10} />}>
          {tab === 'history' ? <HistoryView inv={inv} /> : (
            <>
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <p className="max-w-lg text-muted">Cuenta lo que hay en {STOCK_LOCATION.name} y anota la cantidad. Solo las diferencias se registran, como «{reason.name}».</p>
                <div className="w-56">
                  <p className="mb-1 text-sm"><span className="font-semibold tabular-nums">{counted.length} de {inv.products.length}</span> contados</p>
                  <div role="meter" aria-valuemin={0} aria-valuemax={inv.products.length} aria-valuenow={counted.length} aria-label="Productos contados" className="h-2 rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
              </div>
              <table className="w-full text-left">
                <thead className="border-b border-line text-sm text-muted">
                  <tr><th className="py-2 font-medium">Producto</th><th className="hidden py-2 text-right font-medium sm:table-cell">En el sistema</th><th className="py-2 pl-4 font-medium">Contado</th><th className="py-2 text-right font-medium">Diferencia</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inv.products.map((p) => {
                    const v = counts[p.id] ?? '';
                    const diff = v === '' ? null : Number(v) - inv.balance(p.id);
                    return (
                      <tr key={p.id}>
                        <td className="py-3"><span className="font-semibold">{p.name}</span><span className="block text-xs text-muted">{p.category}</span></td>
                        <td className="hidden py-3 text-right text-muted tabular-nums sm:table-cell">{fmtQty(inv.balance(p.id), p.unit)}</td>
                        <td className="py-3 pl-4">
                          <div className="relative w-36">
                            <input aria-label={`Contado de ${p.name}`} inputMode="decimal" type="number" min={0} step="any" value={v} onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))}
                              className={cn(input, 'h-10 pr-16 text-right tabular-nums', v !== '' && 'border-ink')} />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">{p.unit === 'bottle' ? 'bot.' : p.unit}</span>
                          </div>
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {diff === null ? <span className="text-muted">—</span> : diff === 0 ? <span className="text-sm text-muted">Coincide</span> : (
                            <span className="anim-rise inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ring-2 ring-inset ring-pending">{fmtSigned(diff, p.unit)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </Gate>
      </div>

      {tab === 'count' && inv.view.state === 'ready' && counted.length > 0 && (
        <div className="anim-rise fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:left-[196px]">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
            <p className="text-sm"><span className="font-semibold">{changes.length ? `${changes.length} ${changes.length === 1 ? 'diferencia' : 'diferencias'}` : 'Sin diferencias'}</span> en {counted.length} productos contados.</p>
            <Button variant="ghost" className="ml-auto" onClick={() => setCounts({})}>Borrar conteo</Button>
            <Button disabled={!changes.length || inv.offline} onClick={() => setReviewing(true)}><ClipboardCheck aria-hidden className="size-4" />Revisar {changes.length || ''} {changes.length === 1 ? 'ajuste' : 'ajustes'}</Button>
          </div>
        </div>
      )}

      {reviewing && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-ink/30 p-4" onClick={() => setReviewing(false)}>
          <div role="dialog" aria-modal aria-labelledby="review" onClick={(e) => e.stopPropagation()} className="anim-rise w-full max-w-lg space-y-5 rounded-xl bg-surface p-6 shadow-2xl">
            <h2 id="review" className="text-xl font-bold">Revisar ajustes</h2>
            <p className="text-sm text-muted">Cada fila se registra como «{reason.name}» y deja el saldo igual a lo contado.</p>
            <ul className="divide-y divide-line border-y border-line">
              {changes.map(({ p, diff }) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span><span className="font-semibold">{p.name}</span><span className="block text-sm text-muted tabular-nums">{fmtQty(inv.balance(p.id), p.unit)} → {fmtQty(Number(counts[p.id]), p.unit)}</span></span>
                  <span className="font-semibold tabular-nums">{fmtSigned(diff, p.unit)}</span>
                </li>
              ))}
            </ul>
            <Field label="Nota para todos (opcional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Conteo de cierre" maxLength={500} className={input} /></Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReviewing(false)}>Volver al conteo</Button>
              <Button onClick={apply}>Aplicar {changes.length} {changes.length === 1 ? 'ajuste' : 'ajustes'}</Button>
            </div>
          </div>
        </div>
      )}

      {moving && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-ink/30 p-4" onClick={() => setMoving(false)}>
          <div role="dialog" aria-modal aria-labelledby="move" onClick={(e) => e.stopPropagation()} className="anim-rise w-full max-w-md rounded-xl bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="move" className="text-xl font-bold">Registrar movimiento</h2>
              <Button variant="ghost" aria-label="Cerrar" onClick={() => setMoving(false)}><X aria-hidden className="size-5" /></Button>
            </div>
            <MovementForm inv={inv} onDone={() => setMoving(false)} />
          </div>
        </div>
      )}
      {creating && <ProductDialog inv={inv} onClose={() => setCreating(false)} />}
    </Shell>
  );
}

export default function Inventory() {
  const alt = useAlt();
  return alt === 'b' ? <InventoryB /> : alt === 'c' ? <InventoryC /> : <InventoryA />;
}
