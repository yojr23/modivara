import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddSaleLineDto, CompleteSaleDto, CreateSellableItemDto, OpenLinkedSaleDto, PosSettingsDto, SaleResultDto, SaleStatus, UpdateSellableItemDto,
} from '@modivara/pos-contracts';
import { saleCursor } from '@modivara/pos-contracts';
import { posApi as api, toPosErrorState } from './client.js';

/**
 * Claves por local: nunca se mezclan datos de dos locales. La venta cuelga de `sales`, así que invalidar `sales` refresca
 * a la vez los listados y el detalle. Tiempo real = refetch al mutar y al volver el foco (default de TanStack, PLAN-POS-001 §P5).
 */
export const posKeys = {
  items: (l: string) => ['pos', l, 'items'] as const,
  settings: (l: string) => ['pos', l, 'settings'] as const,
  sales: (l: string) => ['pos', l, 'sales'] as const,
  sale: (l: string, saleId: string) => ['pos', l, 'sales', saleId] as const,
};

const retry = false as const; // un 403/409 no mejora reintentando

/** Estado de UI tipado de un error de hook (`undefined` si no hay error); distingue los errores de negocio de la venta. */
export const posErrorState = (e: unknown) => (e == null ? undefined : toPosErrorState(e));

export const useSellableItems = (l: string) => useQuery({ queryKey: posKeys.items(l), queryFn: () => api.listItems(l), retry });
export const usePosSettings = (l: string) => useQuery({ queryKey: posKeys.settings(l), queryFn: () => api.getSettings(l), retry });
export const useSale = (l: string, saleId: string | null | undefined) =>
  useQuery({ queryKey: posKeys.sale(l, saleId ?? ''), queryFn: () => api.getSale(l, saleId!), enabled: !!saleId, retry });

/**
 * Ventas paginadas por cursor `(opened_at, id)`, más recientes primero. Pide `limit + 1` (tope del contrato: 200):
 * la fila extra solo avisa que hay más y no se muestra.
 */
export const useSales = (l: string, f: { status?: SaleStatus; limit: number }) => {
  const size = Math.min(f.limit, 199);
  return useInfiniteQuery({
    queryKey: [...posKeys.sales(l), 'pages', f],
    queryFn: ({ pageParam }) => api.listSales(l, { ...f, limit: size + 1, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length > size ? saleCursor(last[size - 1]!) : undefined),
    select: (d) => ({ ...d, pages: d.pages.map((p) => p.slice(0, size)) }),
    retry,
  });
};

function catalogMutation<V, R>(key: readonly unknown[], fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
}
export const useCreateSellableItem = (l: string) => catalogMutation(posKeys.items(l), (v: CreateSellableItemDto) => api.createItem(l, v));
export const useUpdateSellableItem = (l: string) =>
  catalogMutation(posKeys.items(l), (v: { itemId: string; input: UpdateSellableItemDto }) => api.updateItem(l, v.itemId, v.input));
export const useDeactivateSellableItem = (l: string) => catalogMutation(posKeys.items(l), (itemId: string) => api.deactivateItem(l, itemId));
export const useUpdatePosSettings = (l: string) => catalogMutation(posKeys.settings(l), (v: PosSettingsDto) => api.updateSettings(l, v));

/**
 * Mutación de venta: `idempotencyKey` la fija la pantalla por intención (reintentar = misma clave). La venta devuelta entra
 * al caché y, con éxito o error (p. ej. 409 `sale_not_open` porque otra persona la cerró), se recargan venta y listados.
 */
function saleMutation<V extends { idempotencyKey: string }>(l: string, fn: (v: V) => Promise<SaleResultDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => qc.setQueryData(posKeys.sale(l, r.sale.id), r.sale),
    onSettled: () => qc.invalidateQueries({ queryKey: posKeys.sales(l) }),
  });
}
type Keyed<T = object> = T & { idempotencyKey: string };
export const useOpenSale = (l: string) => saleMutation(l, (v: Keyed) => api.openSale(l, v.idempotencyKey));
export const useAddSaleLine = (l: string) =>
  saleMutation(l, (v: Keyed<{ saleId: string; input: AddSaleLineDto }>) => api.addLine(l, v.saleId, v.input, v.idempotencyKey));
export const useVoidSaleLine = (l: string) =>
  saleMutation(l, (v: Keyed<{ saleId: string; lineId: string }>) => api.voidLine(l, v.saleId, v.lineId, v.idempotencyKey));
export const useCompleteSale = (l: string) =>
  saleMutation(l, (v: Keyed<{ saleId: string; input: CompleteSaleDto }>) => api.completeSale(l, v.saleId, v.input, v.idempotencyKey));
export const useVoidSale = (l: string) => saleMutation(l, (v: Keyed<{ saleId: string }>) => api.voidSale(l, v.saleId, v.idempotencyKey));
export const useOpenLinkedSale = (l: string) =>
  saleMutation(l, (v: Keyed<{ input: OpenLinkedSaleDto }>) => api.openLinkedSale(l, v.input, v.idempotencyKey));
