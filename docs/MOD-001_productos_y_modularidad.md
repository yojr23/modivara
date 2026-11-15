# MOD-001 — Productos y modularidad (PLAN-003 A0: MOD-01…05, MOD-50)

> **Rama:** `test/plan-003-modularidad` (describe el código en `fe04225`). **Fuente:** `PLAN-003_modularidad_pruebas_por_rama.md` §3 A0/A3.
> **Estado:** documental. Describe lo que el código hace hoy; lo no implementado se marca **pendiente**. ADR-006 sigue «Propuesto» (MOD-00).
> No reemplaza ADR-001/002/003/006, TECH-001 ni DATA-001.

## 1. Nombres (MOD-01)

| Producto (nombre visible) | Identificador técnico | Dónde aparece en el código |
|---|---|---|
| Core | `core` | `domains/core`, esquema `core`. **No es módulo contratable**: `MODULES` (`core-contracts/identity.ts`) no lo incluye. |
| Mesas y llamados | `hospitality` | `domains/hospitality`, esquema, módulo y permisos `hospitality.*`. |
| **Inventario** | **`commerce`** | `domains/commerce`, esquema `commerce`, módulo `commerce`, permisos `commerce.*`. En el portal: «Inventario» (`AppShell.tsx`). |
| Métricas | `analytics` | `domains/analytics`, esquema, módulo y permisos `analytics.*`. |
| POS | `pos` | **No existe en esta rama.** Lo agregan `pos/mesas` (ADR-006): `MODULES`, enum `core.module`, permisos `pos.*`, `domains/pos`. |

- `inventory` como identificador solo existe en: el rol de local `inventory` (`LOCATION_ROLES`), el permiso `analytics.inventory.read` y la ruta `/metrics/inventory`. No es un módulo.
- **Sin renombre masivo** `commerce → inventory`: tocaría paquetes, esquema SQL, enum `core.module`, permisos y datos ya sembrados. Se decide con ADR propio si alguna vez hace falta.
- `pos` y `commerce` son productos distintos. El motivo de stock «Venta» de commerce (`SEEDED_MOVEMENT_REASONS`) es una **salida de inventario**, no una venta POS.

## 2. Matriz de productos (MOD-02)

| Producto | Operación fundamental (sin otros productos) | Puede integrar (opcional) | Prohibido |
|---|---|---|---|
| Core | Negocios, locales, usuarios, sesiones, permisos, entitlements, auditoría | — | Depender de cualquier otro dominio, incluidos sus `*-contracts` |
| Hospitality | Zonas/mesas, gateways/botones, llamados, planos | Analytics (consume sus eventos) | Importar `*-api`/`*-web` ajenos; consultar otro esquema |
| Inventario (`commerce`) | Catálogo SKU por local, unidades, lugares de stock, entradas/salidas/ajustes, saldo | Analytics (consume sus eventos) | Ídem; requerir mesas o precios (commerce no tiene precio ni moneda) |
| Analytics | Proyección de hechos propios desde eventos de las fuentes; reconstrucción | Una o varias fuentes | Exigir todas las fuentes |

**Reglas verificadas por código** (`scripts/separability.mjs`, aplicadas por `pnpm check:separability`):

1. `core` no depende de ningún otro dominio (package.json ni imports). Regresión: `scripts/separability.test.mjs`, caso «MOD-11: core no depende de ningún otro dominio».
2. Un dominio solo depende de `*-contracts` de otro dominio, nunca de `*-api`/`*-web`.
3. Sin rutas internas (`@modivara/x/...`) ni rutas relativas que salgan del dominio.
4. Capas: `domain/` sin Nest/Prisma/Zod/React; `application/` sin Prisma; `apps/api` no importa `domain/` ni `application/`.
5. Cada dominio compila y pasa sus pruebas solo.

Hoy: `core-api` depende solo de `core-contracts` (MOD-10, `5ca4aba`). `analytics-api` depende de `hospitality-contracts` y `commerce-contracts` (esquemas de los eventos que proyecta): permitido por la regla 2.

**No verificado por código (pendiente):** ausencia de FK/consultas entre esquemas y revisión de `schema.prisma`/migraciones (MOD-11 lo pedía; el script no lo hace). La composición sin dominios ausentes se prueba con PostgreSQL real en `apps/api/src/e2e/core-commerce.int.test.ts`, no en el script.

**Integraciones actuales (todas por outbox, ninguna obligatoria):**

| Emisor → evento | Consumidor | Efecto |
|---|---|---|
| core → `core.location.created` v1 | commerce | Motivos + «Principal», solo si el negocio tiene `commerce` |
| core → `core.location.created` v1 | hospitality | `location_settings`, **sin** mirar el entitlement (OPEN en código) |
| core → `core.module.enabled` v1 | commerce | Ídem activación tardía, si `module = commerce` |
| core → `core.module.disabled` v1 | ninguno | Se marca despachado sin efecto |
| hospitality → `hospitality.platform_action.recorded` v1 | core | `audit_log` de acciones de superadmin (contrato en `core-contracts`, MOD-10) |
| hospitality → `hospitality.service_call.*` v1 | analytics | Hechos de llamados |
| commerce → `commerce.stock.{received,issued,adjusted}` v1 | analytics | Hechos de stock |

Composición: `apps/api/src/app.module.ts` (`hostMetadata(core, dominios)`) e `integration-subscribers.module.ts` inyectan solo los suscriptores de los dominios compuestos (MOD-13). El host desplegable elige sus dominios con `MODIVARA_DOMAINS` (`apps/api/src/domains.ts`; por defecto todos; nombre desconocido → no arranca; OPERACION-001 §1).

## 3. Invariantes de venta transversal (MOD-03, para la rama `pos/mesas`)

Especificación para consumo de la rama pos/mesas; **esta rama no tiene código de venta**.

1. Una venta existe y se cierra **sin mesa**: ningún campo obligatorio apunta a un recurso de otro producto.
2. Una venta se cierra **sin Inventario**: el descuento de stock es integración posterior (T03, POS-32…35), por evento.
3. Una venta se cierra **sin Analytics**: `pos.sale.completed.v1` no tiene consumidor obligatorio (con cero suscriptores el poller actual lo marca despachado).
4. Vínculo opcional a un recurso externo (p. ej. una mesa): referencia externa que solo se acepta si la valida un **adaptador registrado en el host** (ADR-006 §4). POS no importa `hospitality-*` ni consulta su esquema.
5. Tenancy como en los demás dominios: `organization_id`/`location_id` del contexto autorizado; acceso validado con `CoreAccessPort`.
6. POS depende solo de `core-contracts`; `check:separability` lo vigila en cuanto exista `domains/pos`.

## 4. Cobro declarado vs pago y facturación (MOD-04)

- El POS registra **cobro declarado**: el usuario declara método y monto (ADR-006 §2). Modivara no mueve dinero.
- **Fuera de alcance:** pago electrónico (pasarela o datáfono integrado), facturación electrónica/fiscal y cálculo de impuestos. Modivara **no sustituye** la facturación del negocio.
- Se transfiere a **POS-04** (rama pos/mesas). En esta rama no hay precios ni montos: `commerce` no modela precio ni moneda.

## 5. Activación, suspensión, retención y replay (MOD-05)

Implementado en A1 (`edb2fe9`, MOD-14/26, MOD-23 mínimo):

| Acción | Qué hace el código | Prueba |
|---|---|---|
| Alta con módulos | `ProvisionOrganization` (solo seed; no hay endpoint de alta de negocios) crea entitlements y un `core.location.created` por local. | `platform.test.ts` |
| Habilitar / suspender | `PUT /api/v1/platform/organizations/:organizationId/modules/:module` con `{ "enabled": bool }`. Permiso `platform.entitlements.manage` (solo superadmin); `module ∈ hospitality, commerce, analytics` (otro → 400); el negocio de plataforma → 404. Suspender lo ya suspendido no hace nada; habilitar lo ya habilitado re-publica `core.module.enabled` por local sin auditar (recuperación, OPERACION-001 §9.4). Peticiones concurrentes del mismo negocio se serializan (`FOR UPDATE` sobre la fila del negocio). Con cambio, en una transacción: entitlement, `audit_log` `entitlement.enabled|disabled` y un `core.module.enabled|disabled` v1 **por local activo**. | `core-commerce.int.test.ts` (T11, T12), `platform.test.ts` |
| Activación tardía de Inventario | Commerce maneja `core.module.enabled` (solo `module = commerce`) y `core.location.created`. En ambos, si el local no está activo o no es del negocio, o el negocio no tiene `commerce` **al momento de procesar**, no hace nada (sin error, sin `failed_at`). Si no, siembra motivos y «Principal» de forma idempotente. | `location-created.subscriber.test.ts`, T11 |
| Activación tardía de Hospitality | No existe a propósito: sin fila en `location_settings` valen los valores por defecto. | — |
| Activación tardía de Analytics | Analytics no consume eventos de módulo. Proyecta los eventos de hospitality/commerce de **todos** los negocios, tenga o no `analytics` (el suscriptor no mira el entitlement); la lectura la protege `@RequireModule('analytics')` + permiso. Si un host corrió sin analytics, los eventos quedaron despachados sin él y se recuperan con `pnpm analytics:rebuild`. | `analytics-rebuild.int.test.ts` |
| Suspensión | Solo cambia el entitlement. **No borra datos.** Rutas con `@RequireModule` → 403 `module_disabled`; `/me` deja de listar el módulo y sus permisos; pulsaciones de gateway con hospitality suspendido se registran como `location_inactive` sin crear llamado. `core.module.disabled` no tiene consumidor. | T12; `device-events.int.test.ts` |
| Reactivación | Mismo endpoint. Datos previos intactos; los defaults de commerce no se duplican. | T12 |

**Política de replay/backfill (lo que rige hoy):**

- No se reaprovecha `core.location.created` para activar a posteriori: hay un evento propio, `core.module.enabled`, emitido solo por el endpoint.
- Toda inicialización por evento es idempotente por diseño (reentrega at-least-once).
- Backfill de Analytics: solo manual, `pnpm analytics:rebuild` (compone los dominios de `MODIVARA_DOMAINS`; vacía las tablas y reprocesa el historial completo de los outbox de las fuentes compuestas (hospitality, commerce), de todos los negocios, en una transacción; un evento inválido aborta y deja la proyección anterior).
- Replay entre productos (p. ej. POS → Inventario): posterior (PLAN-003 §4, T11).

**Retención:** los datos de un módulo suspendido se conservan indefinidamente. **Pendiente:** plazo de retención y purga tras baja definitiva (no implementado ni decidido).

**Abiertos (en código o sin prueba):**

- `ProvisionOrganization` no emite `core.module.enabled` al habilitar un módulo en un negocio que ya tenía locales (`// OPEN` en `provision-organization.ts`). Hoy solo afecta a seeds; el endpoint sí lo emite.
- El suscriptor `hospitality.location-created` no filtra por entitlement y, con un local ya inactivo, agota los 10 intentos (`failed_at`) en vez de ignorarlo (`// OPEN`). Como los suscriptores de un evento se reintentan juntos, ese fallo también reintenta a commerce (que deduplica).
- Suspender/reactivar **Hospitality** por el endpoint no tiene prueba propia (el código es el mismo; la prueba T12 es de commerce).

## 6. Contratos de fuente y métrica (MOD-50, P1 de diseño)

**Hoy:**

- Analytics lee **solo sus propios hechos** (`service_call_facts`, `stock_movement_facts`, deduplicados por `processed_events`). Nunca consulta otro esquema.
- `domains/analytics/api/src/application/event-registry.ts` es el único lugar que decide qué `event_type` entiende; lo demás se ignora.
- `PERMISSION_SOURCES` (`core-contracts/permissions.ts`) liga cada permiso de métrica a su fuente: `analytics.calls.read → hospitality`, `analytics.inventory.read → commerce`.
- **Permisos efectivos, una sola regla** (`core-api/application/effective-permissions.ts`): un permiso vale si el rol lo da, el módulo de su prefijo está habilitado y, si tiene fuente, también la fuente. La usan `GetMe` (navegación, MOD-25), `Authorize` (guard de permiso) y `CoreAccessPort.permissionsAt`. En el backend: sin el permiso por rol → 403 `permission_denied`; con él pero sin módulo o fuente → 403 `module_disabled` (p. ej. `GET /metrics/inventory` con commerce suspendido). El superadmin pasa siempre (ADR-002 D3). Prueba: `effective-permissions.int.test.ts`.
- El portal (`Metrics.tsx`, constante `SOURCES`) repite ese mapeo para decidir pestañas (MOD-52/53).

**Contrato mínimo de una fuente nueva (diseño, no implementado):**

1. Evento versionado en los `*-contracts` del emisor (para POS: `pos.sale.completed.v1`, ADR-006).
2. Lector de historial del emisor registrado en `EVENT_HISTORY_READERS` (lo usa `analytics:rebuild`).
3. Entrada en el registro de eventos de analytics + tabla de hechos propia.
4. Permiso `analytics.<x>.read` con su entrada en `PERMISSION_SOURCES` y su pestaña en `SOURCES`.

La fuente POS (MOD-51) es POS-36…38, posterior. Analytics-only con fuente externa (MOD-55) es P2.
