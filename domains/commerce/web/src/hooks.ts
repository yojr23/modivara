import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AdjustToCountDto, CreateMovementReasonDto, CreateProductDto, CreateStockLocationDto, RegisterMovementDto, UpdateProductDto,
} from '@modivara/commerce-contracts';
import { commerceApi as api, toStockErrorState, type StockFilters } from './client.js';

/** Claves por local (los motivos, por negocio): nunca se mezclan datos de dos locales. */
export const commerceKeys = {
  products: (l: string) => ['commerce', l, 'products'] as const,
  stockLocations: (l: string) => ['commerce', l, 'stock-locations'] as const,
  balances: (l: string) => ['commerce', l, 'balances'] as const,
  movements: (l: string) => ['commerce', l, 'movements'] as const,
  reasons: () => ['commerce', 'reasons'] as const,
};
type Key = readonly unknown[];

const retry = false as const; // un 403/409 no mejora reintentando
const inval = (qc: QueryClient, keys: Key[]) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
function mutation<V, R>(fn: (v: V) => Promise<R>, keys: (v: V) => Key[]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (_r, v) => inval(qc, keys(v)) });
}

/** Estado de UI tipado de un error de hook (`undefined` si no hay error); distingue saldo insuficiente. */
export const stockErrorState = (e: unknown) => (e == null ? undefined : toStockErrorState(e));

export const useProducts = (l: string) => useQuery({ queryKey: commerceKeys.products(l), queryFn: () => api.listProducts(l), retry });
export const useStockLocations = (l: string) => useQuery({ queryKey: commerceKeys.stockLocations(l), queryFn: () => api.listStockLocations(l), retry });
export const useReasons = () => useQuery({ queryKey: commerceKeys.reasons(), queryFn: () => api.listReasons(), retry });
export const useBalances = (l: string, f: StockFilters = {}) =>
  useQuery({ queryKey: [...commerceKeys.balances(l), f], queryFn: () => api.listBalances(l, f), retry });
export const useMovements = (l: string, f: StockFilters = {}) =>
  useQuery({ queryKey: [...commerceKeys.movements(l), f], queryFn: () => api.listMovements(l, f), retry });

export const useCreateProduct = (l: string) => mutation((v: CreateProductDto) => api.createProduct(l, v), () => [commerceKeys.products(l)]);
export const useUpdateProduct = (l: string) =>
  mutation((v: { productId: string; input: UpdateProductDto }) => api.updateProduct(l, v.productId, v.input), () => [commerceKeys.products(l)]);
export const useDeactivateProduct = (l: string) => mutation((productId: string) => api.deactivateProduct(l, productId), () => [commerceKeys.products(l)]);
export const useCreateStockLocation = (l: string) =>
  mutation((v: CreateStockLocationDto) => api.createStockLocation(l, v), () => [commerceKeys.stockLocations(l)]);
export const useCreateReason = () => mutation((v: CreateMovementReasonDto) => api.createReason(v), () => [commerceKeys.reasons()]);
export const useDeactivateReason = () => mutation((reasonId: string) => api.deactivateReason(reasonId), () => [commerceKeys.reasons()]);

// Un movimiento cambia saldos e historial; `idempotencyKey` la fija la pantalla por intento (reintentar = misma clave).
const stockKeys = (l: string) => [commerceKeys.balances(l), commerceKeys.movements(l)];
export const useRegisterMovement = (l: string) =>
  mutation((v: { input: RegisterMovementDto; idempotencyKey?: string }) => api.registerMovement(l, v.input, v.idempotencyKey), () => stockKeys(l));
export const useAdjustToCount = (l: string) =>
  mutation((v: { input: AdjustToCountDto; idempotencyKey?: string }) => api.adjustToCount(l, v.input, v.idempotencyKey), () => stockKeys(l));
