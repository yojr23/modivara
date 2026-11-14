# POS-001 — Especificación del POS horizontal (POS-04)

> **Estado:** borrador para revisión del responsable, 13/11/2026. Rama `pos/mesas`.
> **Origen:** `PLAN-POS-001_pos_mesas_por_rama.md` v3. **Pendiente:** ADR-006 (rama de PLAN-003) debe aceptar POS como quinto producto; hasta entonces esta especificación no es una decisión y `ADR-005` sigue sin anotar (POS-02 espera a ADR-006).

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

Pendiente: qué roles los reciben (ADR-005 §5.4: ¿cualquier `staff` cobra o rol `cashier`?). Se implementa con el entitlement `pos` y la migración de `core.module` (POS-06), después de ADR-006.

## 6. Límites fiscales

El primer entregable registra ventas y cobros **declarados**. No procesa pagos, no calcula impuestos y no emite factura electrónica. Validar los requisitos fiscales de cada mercado antes de venderlo como sustituto de facturación.
