# ADR-005 — Dominio `pos`: cuentas por mesa, separado de inventario

> **Estado: En evaluación.** No está aceptado: decide el responsable. ADR-001 deja el «POS completo» fuera del MVP y lo ubicaba dentro de `commerce`; este documento evalúa un recorte mínimo como **dominio propio** y no cambia ADR-001/003. Si se acepta, esos documentos se enmiendan con una revisión que apunte a este.
> **Fecha:** 09/11/2026 (rama `pos/mesas`, desde `pruebas` en `18289d6`).
> **Convención:** «Hoy» = lo que el repo hace y se puede comprobar; «Propuesta» = lo que se recomienda; «Pregunta» = lo que decide el responsable.

## 0. Decisiones del responsable (09/11/2026)

- **POS es su propio dominio y, a futuro, su propio repositorio**, igual que `core`, `hospitality`, `commerce` y `analytics` (ADR-001 §4, ADR-002 D1). Toda su lógica de negocio vive en `domains/pos`.
- Hay que tener en cuenta el módulo de **inventario** (`commerce`) y la división de módulos: cada dominio se contrata, despliega y separa por su cuenta.

Consecuencia: esto **enmienda ADR-001**, que ponía el POS dentro de `commerce` («Commerce agrupa inventario y POS futuro»).

## 1. Qué se pide

Desde el tablero (`/<negocio>/app/tablero`), tocar una mesa y llevar su cuenta: abrirla, agregar consumos, ver el total y cerrarla cuando paga. Si el negocio también tiene inventario, lo vendido sale del stock.

## 2. Hoy

- **Tablero.** `apps/portal/src/app/Board.tsx`: al tocar una mesa se abre `TableSheet` (etiqueta, ubicación, estado del llamado y su acción). Es el punto natural para mostrar la cuenta. El portal (`apps/portal`) es el shell: puede usar los hooks de varios `domains/<d>/web` en la misma pantalla.
- **Separabilidad** (`scripts/separability.mjs`, `pnpm check:separability`): un paquete de `domains/` solo depende de `@modivara/*-contracts`; sin imports relativos fuera del dominio; `domain/` sin Nest/Prisma/Zod; `apps/api` solo compone. Un esquema y un rol de PostgreSQL por dominio (`infra/postgres/init-schemas.sh`), sin FK ni consultas entre esquemas (DATA-001 §1).
- **Integración entre dominios:** outbox por emisor + `IntegrationEventSubscriber` en el receptor (`handles(event_type)`), registrados en `apps/api/src/integration-subscribers.module.ts`. Ejemplo: commerce se suscribe a `core.location.created` (`presentation/location-created.subscriber.ts`). Cada emisor expone un lector de historial (`*_EVENT_HISTORY`, Q-09) para `analytics:rebuild`.
- **Módulos contratables:** `MODULES = ['hospitality', 'commerce', 'analytics']` (`core-contracts/src/identity.ts`) y el enum `core.module`; entitlement por organización; los guards exigen el módulo (`REQUIRED_MODULE_KEY`). Permisos en `core-contracts/src/permissions.ts`; `ROLE_PERMISSIONS` ya prevé dividir `staff` (mesero/cajero).
- **Inventario (`commerce`).** `products` por local con `unit` y **sin precio**; un insumo («Ron 750 ml») no es lo que se vende («Mojito»). Movimientos por `MovementRecorder` con `idempotency_key`; motivo sembrado **«Venta» (out)**. **Saldo nunca negativo**: `CHECK (quantity >= 0)` en `stock_balances` + guarda en `StockBalance` → `insufficient_stock` (marcado `ponytail:` provisional, TECH-001 §16.8). Sin recetas (ADR-001).
- **Mesas** (`hospitality.dining_tables`). Hospitality no emite eventos de mesas (solo `service_call.*` y `platform_action.recorded`).
- **Tiempo real.** Solo `service_call.changed` (hospitality).

## 3. Propuesta

### 3.1 Fronteras

| Dominio | Sabe | No sabe |
|---|---|---|
| `pos` | Carta (ítems con precio), cuentas, líneas, cobro. | Stock, productos de inventario, cómo se arma un trago. |
| `commerce` | Productos, stock, movimientos y **qué descuenta cada ítem vendido**. | Cuentas, precios, mesas. |
| `hospitality` | Mesas, llamados. | Cuentas. |

- **Dirección de dependencias:** `commerce-api` depende de `pos-contracts` (para suscribirse a la venta). `pos` no depende de `commerce` ni de `hospitality`: se puede contratar solo.
- **La venta no espera al inventario.** POS cierra la cuenta y emite `pos.sale.completed.v1` por su outbox; commerce reacciona después. Si inventario falla o no está contratado, la venta sigue cerrada.
- **La relación «ítem de carta → producto de inventario» vive en commerce** (es lógica de inventario: cuánto se descuenta). POS no guarda ids de productos.
- La mesa llega del cliente como `table_id` + `table_label` (copia). POS no puede validarla contra hospitality (sin SQL cruzado y sin eventos de mesas); un id falso solo afecta al propio local, que viene del contexto autorizado.

### 3.2 Paquetes (mismo molde que los otros cuatro dominios)

```text
domains/pos/contracts   eventos (pos.sale.completed v1), DTOs Zod, POS_EVENT_HISTORY
domains/pos/api         domain/ (Check, CheckLine, MenuItem), application/ (un caso por clase),
                        infrastructure/prisma (esquema `pos`, outbox), presentation/ (controladores)
domains/pos/web         cliente y hooks React Query (useMenu, useOpenChecks, useCheckActions)
```

Cambios fuera de `domains/pos` (solo composición o el contrato compartido):

- `core-contracts`: `'pos'` en `MODULES`; permisos `pos.menu.manage`, `pos.checks.read`, `pos.checks.write` y su entrada en `ROLE_PERMISSIONS`.
- `core`: migración que agrega `pos` al enum `core.module`.
- `infra/postgres/init-schemas.sh` y `.env.example`: esquema y rol `pos` (`POS_DB_PASSWORD`). Las bases existentes necesitan crear el esquema a mano (el script solo corre al crear el volumen).
- `apps/api`: `PosModule.forRoot()`, su suscriptor/outbox/lector de historial en `integration-subscribers.module.ts`.
- `apps/portal`: panel en `TableSheet` y pantalla «Carta», visibles solo con el módulo `pos` habilitado.

### 3.3 Datos del esquema `pos`

```sql
CREATE TABLE pos.menu_items (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,          -- carta por local, como el catálogo de commerce
  name            text NOT NULL,
  category        text,
  price           numeric(12,2) NOT NULL CHECK (price >= 0),
  deactivated_at  timestamptz,
  UNIQUE (id, location_id)
);

CREATE TYPE pos.check_status AS ENUM ('open', 'closed', 'voided');

CREATE TABLE pos.checks (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  table_id        uuid NOT NULL,          -- hospitality.dining_tables.id, sin FK
  table_label     text NOT NULL,
  status          pos.check_status NOT NULL DEFAULT 'open',
  opened_by       uuid NOT NULL,
  opened_at       timestamptz NOT NULL,
  closed_by       uuid,
  closed_at       timestamptz,
  total           numeric(12,2),          -- se fija al cerrar
  payment_method  text                    -- anotado, no procesado: cash | card | transfer
);
-- Una cuenta abierta por mesa: lo garantiza la base.
CREATE UNIQUE INDEX uq_checks_open_table ON pos.checks (location_id, table_id) WHERE status = 'open';

CREATE TABLE pos.check_lines (
  id            uuid PRIMARY KEY,
  check_id      uuid NOT NULL REFERENCES pos.checks(id),
  menu_item_id  uuid NOT NULL,
  item_name     text NOT NULL,            -- copia
  unit_price    numeric(12,2) NOT NULL,   -- copia: cambiar el precio no altera cuentas abiertas
  quantity      integer NOT NULL CHECK (quantity > 0),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL,
  voided_at     timestamptz,              -- quitar una línea la anula, no la borra
  voided_by     uuid
);
-- + pos.outbox_events, igual a los otros dominios (con failed_at).
```

### 3.4 API de `pos`

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET/POST/PATCH /locations/:l/menu-items` (+ `/:id/deactivate`) | `pos.checks.read` / `pos.menu.manage` | Carta del local. |
| `GET  /locations/:l/checks?status=open` | `pos.checks.read` | Cuentas abiertas con sus líneas (el tablero cruza por `table_id`). |
| `POST /locations/:l/checks` `{table_id, table_label}` | `pos.checks.write` | Abre; 409 si ya hay una abierta. |
| `POST /locations/:l/checks/:c/lines` `{menu_item_id, quantity}` | `pos.checks.write` | Agrega; 409 si la cuenta no está abierta o el ítem está desactivado. |
| `POST /locations/:l/checks/:c/lines/:line/void` | `pos.checks.write` | Anula una línea. |
| `POST /locations/:l/checks/:c/close` `{payment_method}` | `pos.checks.write` | Fija `total`, cierra y escribe `pos.sale.completed.v1` en la misma transacción. |

Evento `pos.sale.completed` v1 (snake_case, sobre de `core-contracts`):

```json
{ "check_id": "…", "location_id": "…", "table_id": "…", "table_label": "Mesa 4",
  "total": "48000.00", "payment_method": "cash", "closed_at": "…", "closed_by": "…",
  "lines": [{ "line_id": "…", "menu_item_id": "…", "item_name": "Club Colombia", "unit_price": "8000.00", "quantity": 2 }] }
```

### 3.5 Inventario: lo que agrega `commerce`

- Tabla `commerce.sale_consumptions (menu_item_id, product_id, quantity)`: «vender 1 *Club Colombia* descuenta 1 *botella Club Colombia*». Un ítem sin fila no descuenta nada (un Mojito, mientras no haya recetas). Aquí mismo crecería una receta (varias filas por ítem) sin tocar POS.
- `SaleCompletedSubscriber` en `commerce/api/presentation`: si el negocio tiene `commerce`, por cada línea con consumo registra un movimiento **«Venta»** con `MovementRecorder`; `idempotency_key` derivada de `line_id` + `product_id` (la reentrega del outbox no descuenta dos veces).
- Pantalla para mapear: en Inventario, el portal combina `useMenu` (pos-web) con los hooks de commerce-web; commerce guarda `menu_item_id` como uuid sin FK.
- **Choque con el saldo no negativo:** una venta real con stock en 0 (conteo atrasado) hoy daría `insufficient_stock`; el poller reintentaría 10 veces y quedaría en `failed_at`. Ver Pregunta 3.

### 3.6 Portal

- `TableSheet`: «Cuenta: $ 48.000 · 5 consumos» si hay cuenta abierta, y botón «Cuenta» que abre un panel lateral (líneas, buscador de la carta, cantidad, «Cobrar»).
- Pantalla «Carta» para `pos.menu.manage`.
- `// ponytail:` refresco cada 10 s y al volver a la pestaña, sin socket; agregar `check.changed` por socket si dos meseros editan la misma mesa a la vez en el piloto.

### 3.7 Fuera del recorte

Dividir cuenta, propinas, descuentos, cambio de mesa, apertura y arqueo de caja, comandas a cocina o barra, impresión, pagos integrados, facturación electrónica, recetas, ventas sin mesa (mostrador).

## 4. Riesgos

- **Fiscal (Colombia).** Una venta al consumidor exige factura electrónica o documento equivalente electrónico POS ante la DIAN. Esto **no** emite documentos fiscales: es control interno y el negocio sigue facturando con su sistema. Hay que decirlo en la pantalla y en el contrato, y confirmarlo con un contador antes del piloto.
- **Doble digitación** si el bar ya tiene POS: el valor aparece solo si reemplaza la comanda en papel.
- **Costo de un quinto dominio:** esquema, rol, outbox, poller, lector de historial, módulo en core y su entrada en CI/separabilidad. Es el precio de poder venderlo y separarlo solo; es el mismo molde, sin piezas nuevas.

## 5. Preguntas para el responsable

1. **Alcance:** ¿basta «cuenta por mesa + cobrar con método anotado», o el piloto necesita caja/arqueo, dividir cuenta o propinas?
2. **Descuento de stock:** ¿se hace en esta primera entrega (con `sale_consumptions` 1:1) o queda para después de validar la cuenta por mesa?
3. **Venta con stock insuficiente:** (a) se permite saldo negativo **solo** para el motivo «Venta» (quitar el CHECK y dejar la regla en `StockBalance`), (b) se descuenta hasta 0 y se registra la diferencia como alerta de inventario, o (c) se omite la línea y se avisa. Recomendado: (a), el saldo negativo es la señal honesta de que falta un conteo.
4. **Roles:** ¿cualquier `staff` cobra, o se crea `cashier` (y quién edita la carta: solo `admin`)?
5. **Fiscal:** ¿confirmado que es control interno y no reemplaza la facturación del bar?

## 6. Orden si se acepta

1. `pos-contracts` + `domains/pos/api/domain` (`Check`, `CheckLine`, `MenuItem`) con sus pruebas unitarias.
2. Módulo `pos` en core (`MODULES`, enum, permisos), esquema y rol en `init-schemas.sh`; migración `0001_init` de `pos` con outbox.
3. Casos de uso, controladores y `PosModule`; integración: 409 por doble cuenta abierta, cierre que escribe el evento, otro negocio → 404. `pnpm check:separability` en verde.
4. `pos-web` y portal (Carta y panel en `TableSheet`); E2E «abrir, agregar dos ítems, cobrar».
5. (Si Pregunta 2 = sí) `commerce.sale_consumptions` + `SaleCompletedSubscriber` con la regla de la Pregunta 3; integración: reentrega no descuenta dos veces.
6. (Después) analytics suscrito a `pos.sale.completed.v1`.
