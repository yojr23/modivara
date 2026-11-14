# POS-001 — Especificación del POS horizontal (POS-04)

> **Estado:** borrador para revisión del responsable, 13/11/2026. Rama `pos/mesas`.
> **Origen:** `PLAN-POS-001_pos_mesas_por_rama.md` v3 y `ADR-006` (propuesto, aplicado en esta rama).

## 1. Lenguaje

| Término | Significado | Código |
|---|---|---|
| Artículo vendible | Lo que se ofrece y su precio, por local. No es un producto de inventario. | `SellableItem` |
| Venta | Ticket abierto, cerrado o anulado. No exige contexto externo. | `Sale` (`open` / `completed` / `voided`) |
| Línea | Artículo vendido con snapshot de nombre, SKU, unidad y precio. | `SaleLine` |
| Cobro declarado | Medio de pago que el operador anota. No es un pago procesado ni un comprobante fiscal. | `PaymentMethod` |

POS no conoce mesas, cartas, meseros, tallas ni tipos de negocio. `domains/pos/api/src/agnosticism.test.ts` falla si aparecen esas palabras o una dependencia de `hospitality`, `commerce` o `analytics` en el código de `domains/pos`.

## 2. Decisiones de PLAN-POS-001 §7

| # | Decisión | Estado |
|---|---|---|
| 1 | Agregado `Sale` / `SaleLine`; evento `pos.sale.completed.v1`. | Elegida por el responsable (13/11). |
| 2 | Cantidad NUMERIC(12,3) > 0. Unidades de medida neutrales: `unit`, `kg`, `g`, `l`, `ml`, `m`, `h`; solo `unit` exige enteros. | Provisional. |
| 3 | Un solo cobro declarado por venta: `cash`, `card`, `transfer`, `other`. Sin multi-tender. | Provisional. |
| 4 | Referencias externas: fuera del agregado `Sale`, en `pos.sale_external_links` validado por un adaptador registrado (POS-15, POS-27). | Pendiente de implementar; bloqueado por ADR-006. |
| 5 | Moneda ISO 4217 por artículo y por venta; deben coincidir. Precio NUMERIC(14,2) ≥ 0. Total = suma de líneas, cada línea `precio × cantidad` redondeada a centésimas, mitad hacia arriba. Sin impuestos ni factura. | Provisional. Todas las monedas con 2 decimales (ver `ponytail:` en `catalog.ts`). |
| 6 | Producto «Inventario» = dominio técnico `commerce`; no se renombra en esta rama. | Del plan. |
| 7 | Integración con Core solo por `CoreAccessPort` y `core-contracts`. | Implementado. |

## 3. Reglas de la venta

- Abrir: local activo del negocio del actor (`CoreAccessPort`); moneda en el comando (`// OPEN:` hasta la configuración por local, POS-09).
- Agregar línea: venta abierta, artículo activo del mismo negocio y local (si no, `not_found`), misma moneda (`currency_mismatch`), cantidad válida para la unidad (`invalid_quantity`).
- Anular línea: queda guardada con `voidedAt`/`voidedBy` y sale del total.
- Cerrar: al menos una línea vigente (`empty_sale`), cobro declarado válido; registra `pos.sale.completed.v1` para el outbox. Cerrada o anulada no admite cambios (`sale_not_open`).
- Anular venta: solo abierta; sin evento. Devoluciones de ventas cerradas quedan fuera del primer entregable.
- Editar artículo: nombre, SKU, categoría y precio; unidad y moneda no. Las líneas ya agregadas conservan su snapshot.

## 4. Evento `pos.sale.completed.v1`

Sobre común de `core-contracts` y payload en `domains/pos/contracts/src/events.ts`: `sale_id`, `currency`, `total`, `payment_method`, `completed_at`, `actor_user_id`, `lines[]` (`line_id`, `sellable_item_id`, `sku`, `name`, `unit`, `unit_price`, `quantity`, `line_total`). Sin campos de mesa ni de inventario.

## 5. Permisos (matriz propuesta para POS-06)

| Permiso | Uso |
|---|---|
| `pos.catalog.manage` | Crear, editar y desactivar artículos vendibles. |
| `pos.sales.operate` | Abrir ventas, agregar y anular líneas, cerrar con cobro declarado. |
| `pos.sales.void` | Anular una venta abierta. |
| `pos.sales.read` | Consultar ventas e historial. |

Roles (decisión del responsable, 13/11: se crea `cashier`): `admin` recibe los cuatro; `cashier` (rótulo «Caja») recibe `pos.sales.operate` y `pos.sales.read`; `staff` e `inventory` ninguno. Los roles se combinan: un mesero que cobra tiene `staff` + `cashier`.

## 6. Límites fiscales

El primer entregable registra ventas y cobros **declarados**. No procesa pagos, no calcula impuestos y no emite factura electrónica. Validar los requisitos fiscales de cada mercado antes de venderlo como sustituto de facturación.

## 7. Diseño de implementación (13/11/2026)

Orden de commits: Core → persistencia → API y host → web y pantalla → adaptador de mesas → E2E y fitness tests.

**Core (POS-06).** `MODULES` += `pos`; `LOCATION_ROLES` += `cashier`; permisos de §5. Migración de core `0003_pos_module` con `ALTER TYPE "module" ADD VALUE 'pos'` y `ALTER TYPE "location_role" ADD VALUE 'cashier'`. Seeds: `bar-demo` con los cuatro productos y usuario `caja1` (`cashier`); `bar-demo-pisos` sin `pos` (regresión Hospitality-only); negocio nuevo `tienda-demo` solo con `pos` (POS-only, T02). Activar o revocar sigue siendo por `ProvisionOrganization`/entitlements de Core; no se crea otro onboarding.

**Persistencia (POS-07, POS-14, POS-15).** Esquema `pos`, rol `pos_app`, `POS_DATABASE_URL`. Tablas `location_settings` (moneda por local), `sellable_items`, `sales`, `sale_lines`, `sale_external_links`, `idempotency_keys`, `outbox_events`. Montos `NUMERIC(14,2)`, cantidades `NUMERIC(12,3)`, CHECK de positivos y estados. Nombre y SKU únicos entre activos por local (índices parciales). `sale_external_links(provider, resource_type, resource_id, sale_id, active)` con índice único parcial `WHERE active`: un vínculo activo por recurso externo; se desactiva en la misma transacción que cierra o anula la venta.

**Concurrencia e idempotencia (POS-18).** Cada mutación de venta corre en una transacción con `SELECT … FOR UPDATE` de la venta. `Idempotency-Key` (uuid, header) obligatorio en abrir, agregar línea, anular línea, cerrar y anular venta: `idempotency_keys(organization_id, key, operation, fingerprint, sale_id)`; misma clave y misma petición → 200 con el estado actual (`replayed: true`); misma clave con otra petición → 409 `idempotency_key_reused`.

**Moneda por local (POS-09).** `GET/PUT /locations/:locationId/pos/settings`; sin fila, `COP`. Artículos y ventas toman la moneda del local; el cliente no la envía.

**API (POS-16, POS-17).** Bajo `/api/v1/locations/:locationId/pos/`: `items` (GET, POST), `items/:itemId` (PATCH), `items/:itemId/deactivate` (POST), `settings` (GET, PUT), `sales` (GET con `status`, `limit`, `cursor`; POST), `sales/:saleId` (GET), `sales/:saleId/lines` (POST), `sales/:saleId/lines/:lineId/void`, `sales/:saleId/complete`, `sales/:saleId/void` (POST), `links` (POST). Módulo `pos` en todas; permisos: leer catálogo, ventas y ajustes `pos.sales.read`; gestionar catálogo y ajustes `pos.catalog.manage`; operar y vínculos `pos.sales.operate`; anular venta `pos.sales.void`.

**Referencias externas (POS-15, POS-27, POS-28).** POS define el puerto `ExternalReferenceValidator { provider; validate(ctx, resourceType, resourceId) }` y el token `POS_REFERENCE_VALIDATORS`. `POST links` con `{provider, resource_type, resource_id}` busca el vínculo activo o abre venta + vínculo en una transacción; proveedor no registrado o recurso inválido → 404. El validador `hospitality` vive en el host (`apps/api/src/integrations/`), usa los casos de uso públicos de Hospitality y exige el módulo `hospitality`. Ningún archivo de `domains/pos` nombra al proveedor.

**Composición (POS-08, POS-40).** `PosModule.forRoot()` como los demás; host completo lo importa. Prueba de integración con un host Core + POS sin variables ni módulos de Hospitality, Commerce o Analytics.

**Web (POS-22…24, POS-29, POS-30).** `domains/pos/web` (cliente + hooks). Pantalla `ventas` del portal (módulo `pos`, permiso `pos.sales.read`): Vender, Catálogo e Historial. Si el negocio también tiene `hospitality`, el portal (composición) agrega acceso «Por mesa» en la pantalla de ventas, que funciona en celular y sin plano, y la acción «Venta» en la ficha de la mesa del tablero. Completar un llamado no toca la venta ni viceversa.
