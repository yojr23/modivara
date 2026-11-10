# ADR-005 — POS mínimo: cuentas por mesa desde el tablero

> **Estado: En evaluación.** No está aceptado: decide el responsable. ADR-001 deja el «POS completo» fuera del MVP (§ alcance, «Fuera del MVP») y ADR-003 lo repite; este documento evalúa un recorte mínimo y no cambia esos documentos. Si se acepta, se enmiendan con una revisión que apunte a este.
> **Fecha:** 09/11/2026 (rama `pos/mesas`, desde `pruebas` en `18289d6`).
> **Convención:** «Hoy» = lo que el repo hace y se puede comprobar; «Propuesta» = lo que se recomienda; «Pregunta» = lo que decide el responsable.

## 1. Qué se pide

Desde el tablero (`/<negocio>/app/tablero`), tocar una mesa y llevar su cuenta: abrirla, agregar consumos, ver el total y cerrarla cuando paga.

## 2. Hoy

- **Tablero.** `apps/portal/src/app/Board.tsx`: al tocar una mesa del plano o de la cola se abre `TableSheet` (etiqueta, ubicación, estado del llamado, acción «Marcar en atención»/«Finalizar»). Es el punto natural para mostrar la cuenta.
- **Dominio dueño.** ADR-001 asigna el POS a `commerce` («inventario, catálogo y, en una evolución futura, POS/ventas») y ya nombra el evento `commerce.sale.completed.v1`. Hospitality no controla POS (ADR-001).
- **Catálogo.** `commerce.products` (por local): `name`, `sku`, `category`, `unit` (`unit|bottle|kg|g|l|ml`). **No hay precio.** Un producto de inventario («Ron 750 ml») no es lo mismo que lo que se vende («Mojito»).
- **Inventario.** `MovementRecorder` (`application/use-cases/register-movement.ts`) registra movimientos con `idempotency_key` y el motivo sembrado **«Venta» (out)** ya existe (`SEEDED_MOVEMENT_REASONS`). Sin recetas (ADR-001 las excluye).
- **Mesas.** Viven en `hospitality.dining_tables`. Commerce no puede hacer SQL a otro esquema (DATA-001 §1): referencia la mesa por `table_id` (uuid, sin FK) y guarda la etiqueta como copia.
- **Módulos y permisos.** `core.module` = `hospitality | commerce | analytics` (entitlement por organización). Permisos commerce: `catalog.manage`, `reasons.manage`, `stock.read`, `stock.write`; `ROLE_PERMISSIONS` ya prevé dividir `staff` (mesero/cajero) agregando una entrada.
- **Tiempo real.** Solo existe `service_call.changed` (hospitality). Commerce no emite nada por socket.

## 3. Propuesta (recorte mínimo)

«Cuenta por mesa» = control interno de consumos, **no** caja ni documento fiscal.

### Datos (`commerce`, migración `0003_checks`)

```sql
-- Precio de venta en el mismo catálogo: lo vendible es lo que tiene precio.
ALTER TABLE commerce.products ADD COLUMN price numeric(12,2) CHECK (price >= 0);

CREATE TYPE commerce.check_status AS ENUM ('open', 'closed', 'voided');

CREATE TABLE commerce.checks (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  table_id        uuid NOT NULL,          -- hospitality.dining_tables.id, sin FK (DATA-001 §1)
  table_label     text NOT NULL,          -- copia al abrir
  status          commerce.check_status NOT NULL DEFAULT 'open',
  opened_by       uuid NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_by       uuid,
  closed_at       timestamptz,
  total           numeric(12,2),          -- se fija al cerrar
  payment_method  text                    -- anotado, no procesado: efectivo | tarjeta | transferencia
);
-- Una cuenta abierta por mesa: lo garantiza la base, no la aplicación.
CREATE UNIQUE INDEX uq_checks_open_table ON commerce.checks (location_id, table_id) WHERE status = 'open';

CREATE TABLE commerce.check_lines (
  id           uuid PRIMARY KEY,          -- también idempotency_key del movimiento «Venta»
  check_id     uuid NOT NULL REFERENCES commerce.checks(id),
  product_id   uuid NOT NULL,
  product_name text NOT NULL,             -- copia
  unit_price   numeric(12,2) NOT NULL,    -- copia: cambiar el precio no altera cuentas abiertas
  quantity     numeric(12,3) NOT NULL CHECK (quantity > 0),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,               -- quitar una línea la anula, no la borra
  voided_by    uuid
);
```

### API (`commerce`, un controlador `checks.controller.ts`)

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET  /locations/:l/checks?status=open` | `commerce.sales.read` | Cuentas abiertas del local (el tablero las cruza por `table_id`). |
| `POST /locations/:l/checks` `{table_id, table_label}` | `commerce.sales.write` | Abre; 409 si ya hay una abierta (índice único). |
| `POST /locations/:l/checks/:c/lines` `{product_id, quantity}` | `commerce.sales.write` | Agrega; precio y nombre copiados del producto. 409 si la cuenta no está abierta. |
| `POST /locations/:l/checks/:c/lines/:line/void` | `commerce.sales.write` | Anula una línea. |
| `POST /locations/:l/checks/:c/close` `{payment_method}` | `commerce.sales.write` | Calcula `total`, cierra y emite `commerce.sale.completed.v1` por outbox. |

Permisos nuevos `commerce.sales.read|write` en `PERMISSIONS`; en el piloto se dan a `admin` y `staff`. Entitlement: el de `commerce` existente (ver Pregunta 4).

### Portal

- `TableSheet` muestra «Cuenta: $ 48.000 · 5 consumos» si hay cuenta abierta y un botón «Cuenta» que abre un panel lateral: lista de líneas, buscador de productos con precio, cantidad, «Cobrar» (elige método y cierra).
- Hook `useOpenChecks(l)` en `domains/commerce/web` con React Query, igual que `useActiveCalls`.
- `// ponytail:` refresco por intervalo (10 s) y al volver a la pestaña, en vez de socket; agregar `check.changed` por socket si dos meseros editan la misma mesa a la vez en el piloto.

### Fuera del recorte (cada uno es una decisión aparte)

Dividir cuenta, propinas, descuentos, cambio de mesa, apertura/arqueo de caja, comandas a cocina/barra, impresión de tiquete, pagos integrados, facturación electrónica, recetas.

## 4. Riesgos

- **Fiscal (Colombia).** Una venta al consumidor exige factura electrónica o documento equivalente electrónico POS ante la DIAN. Esta propuesta **no** emite documentos fiscales: el negocio sigue facturando con su sistema actual y esto es control interno. Hay que dejarlo dicho en la pantalla y en el contrato, y confirmarlo con un contador antes del piloto. Integrar un proveedor tecnológico de facturación es un proyecto propio.
- **Doble digitación.** Si el bar ya tiene POS, el mesero registraría dos veces; el valor real aparece solo si reemplaza la libreta/comanda en papel. Validar con el bar piloto qué usa hoy.
- **Catálogo mezclado.** Poner precio en `products` mezcla vendibles e insumos en la misma lista de Inventario (ver Pregunta 2).

## 5. Preguntas para el responsable

1. **Alcance:** ¿basta «cuenta por mesa + cerrar con método anotado», o el piloto necesita caja/arqueo, dividir cuenta o propinas desde el inicio?
2. **Catálogo:** ¿precio en `products` (lo vendible = lo que tiene precio; un «Mojito» sería un producto sin movimientos de stock) o una tabla aparte `menu_items` con vínculo opcional a un producto?
3. **Inventario:** ¿al cerrar la cuenta se descuenta stock con el motivo «Venta» (solo productos 1:1, p. ej. cerveza en botella; sin recetas), o se deja para después?
4. **Módulo:** ¿se vende como parte de `commerce` (sin migración en core) o como módulo `pos` contratable aparte (nuevo valor en `core.module`, como sugiere ADR-001 «módulos contratables por separado»)?
5. **Roles:** ¿cualquier `staff` cobra, o se separa un rol `cashier` (una entrada en `ROLE_PERMISSIONS`)?
6. **Fiscal:** ¿confirmado que es control interno y no reemplaza la facturación del bar?

## 6. Orden si se acepta

1. Migración + dominio `Check` con sus reglas (abrir, agregar, anular, cerrar) y su prueba unitaria.
2. Casos de uso y controlador; prueba de integración del 409 por doble cuenta abierta y del cierre que emite el evento.
3. Hook web y panel en `TableSheet`; una prueba E2E «abrir, agregar dos productos, cobrar».
4. (Si Pregunta 3 = sí) descuento de stock al cerrar vía `MovementRecorder`, idempotente por `check_lines.id`.
5. (Después) métricas de ventas en analytics suscritas a `commerce.sale.completed.v1`.
