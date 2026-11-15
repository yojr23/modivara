# MOD-002 — Matriz de escenarios PLAN-003 (MOD-70/71/72)

> **Rama:** `test/plan-003-modularidad` (archivos al `fe04225`). **Fuente:** `PLAN-003_modularidad_pruebas_por_rama.md` §3 A4 y §4.
> Cada fila nombra la prueba que lo demuestra. Si no hay prueba real, dice **sin prueba**. La columna Estado se llena con `PASS <SHA>` tras la corrida final.

## Cómo correr

| Tipo | Requisito | Comando |
|---|---|---|
| INT (`*.int.test.ts`) | `docker compose --profile test up -d --wait db-test` (base compartida: una corrida a la vez) | `pnpm exec vitest run --config vitest.integration.config.ts <archivo>` |
| INT Core + Commerce | ídem | `pnpm test:composition:core-commerce` |
| UNIT | — | `pnpm --filter <paquete> exec vitest run <ruta dentro del paquete>` |
| E2E | Demo Docker reconstruida con este código y sembrada (`zapateria-demo`, `restaurante-demo`); ver `e2e/README.md` | `pnpm test:e2e <spec>` |
| Todo | ídem | `pnpm build && pnpm typecheck && pnpm check:separability && pnpm test && pnpm test:integration && pnpm test:e2e` |

Paquetes: `@modivara/core-api`, `@modivara/core-contracts`, `@modivara/commerce-api`, `@modivara/hospitality-api`, `@modivara/portal`.

## Escenarios de esta rama (MOD-70)

| ID | Escenario | Evidencia (archivo › prueba) | Tipo | Estado |
|---|---|---|---|---|
| T01 | Core + Inventario, zapatería sin otros productos | `apps/api/src/e2e/core-commerce.int.test.ts` › «no instancia providers ni consumidores de los dominios ausentes», «zapatería: login, producto SKU por unidad, …, /health/ready», «la base de prueba no tiene esquemas ni tablas de Hospitality/Analytics» | INT (host Core + Commerce, PostgreSQL con solo `core` y `commerce`, sin `HOSPITALITY_/ANALYTICS_DATABASE_URL`) | PENDIENTE de corrida final |
| T01 | ídem en el portal (MOD-60/61/74) | `e2e/inventory-only.spec.ts` › «zapatería: entrada de 15, dos salidas de 1, saldo 13 …», «zapatería: el menú solo muestra Inventario y Usuarios …» | E2E (instalación completa; negocio con solo `commerce`) | PENDIENTE de corrida final |
| T05 | Inventario + Analytics sin Hospitality | `domains/core/api/src/application/get-me.test.ts` › «commerce + analytics: métricas de inventario sí, de llamados no»; `apps/portal/src/routes/routes.test.tsx` › «commerce + analytics: Métricas muestra inventario y no consulta nada de hospitality» | UNIT (repositorios en memoria; `fetch` simulado) | PENDIENTE de corrida final |
| T05 | ídem con composición real | **sin prueba**: no hay host Core + Commerce + Analytics ni negocio demo `commerce + analytics` para E2E. Por el criterio de rigor de PLAN-003 §4, T05 no queda certificado solo con UNIT. | — | PENDIENTE (sin prueba) |
| T07 | Hospitality-only | `e2e/hospitality-only.spec.ts` › «restaurante: tablero y espacios sin inventario ni métricas»; `get-me.test.ts` › «solo hospitality: sin permisos de commerce ni analytics»; `routes.test.tsx` › «Espacios sin analytics no pide métricas de llamados» | E2E (instalación completa; negocio con solo `hospitality`) + UNIT | PENDIENTE de corrida final |
| T07 | Host Core + Hospitality | **sin prueba** (solo existe el host parcial Core + Commerce). | — | PENDIENTE (sin prueba) |
| T09 | Piloto Hospitality + Inventario + Analytics (regresión) | Suites completas en el host de producción (`AppModule`). Específicas: `apps/api/src/e2e/{analytics-projection,location-events,platform-audit,realtime,hospitality-config,analytics-metrics,seed-history}.int.test.ts`; E2E `service-call`, `inventory`, `inventory-settings`, `metrics`, `history`, `spaces`, `console`, `mqtt`, `users`, `auth`, `diagnostics` | INT + E2E | PENDIENTE de corrida final |
| T09 | Auditoría de superadmin intacta tras MOD-10 | `apps/api/src/e2e/platform-audit.int.test.ts` › «cada acción queda en core.audit_log …; reentregar no duplica» | INT | PENDIENTE de corrida final |
| T11-Commerce | Habilitación tardía de Inventario | `core-commerce.int.test.ts` › «T11 (MOD-14): local creado antes de contratar commerce → …»; `domains/commerce/api/src/presentation/location-created.subscriber.test.ts` › «MOD-14: sin commerce contratado no siembra nada …», «MOD-14: core.module.enabled de commerce inicializa el local una sola vez …»; `domains/core/api/src/application/platform.test.ts` › «SetModuleEnabled (MOD-14/26): …» | INT + UNIT | PENDIENTE de corrida final |
| T12 | Entitlement revocado: Inventario | `core-commerce.int.test.ts` › «T12 (MOD-26): suspender → 403 module_disabled sin borrar nada; reactivar …»; `domains/commerce/api/src/presentation/inventory-api.test.ts` › «… sin módulo 403 …» (2) | INT + UNIT | PENDIENTE de corrida final |
| T12 | Entitlement revocado: Hospitality | `domains/hospitality/api/src/presentation/config-api.test.ts` › «… módulo deshabilitado 403»; `domains/hospitality/api/src/presentation/device-events.int.test.ts` › «la pulsación se registra como location_inactive sin crear llamado …»; `domains/hospitality/api/src/infrastructure/iot/mqtt.int.test.ts` › «negocio sin el módulo hospitality: …» | UNIT + INT (`CoreAccessPort` simulado) | PENDIENTE de corrida final |
| T12 | Suspender y reactivar Hospitality por el endpoint | **sin prueba** (T12 por endpoint solo cubre commerce). | — | PENDIENTE (sin prueba) |
| T12 | Entitlement revocado: Analytics | `apps/api/src/e2e/analytics-metrics.int.test.ts` › «con el módulo deshabilitado es 403» | INT | PENDIENTE de corrida final |
| T14 | Otro negocio / otro local | `apps/api/src/e2e/permissions-matrix.int.test.ts` › «local de otro negocio -> 404 …», «ids de otro negocio bajo un local propio -> 404», «superadmin sin acceso al local: nunca 2xx», «Socket.IO … local ajeno»; `domains/core/api/src/presentation/users.int.test.ts` › «aislamiento entre negocios», «alcance por local dentro del negocio»; `hospitality-config.int.test.ts` › «un usuario de bar-demo-pisos no ve ni toca las mesas de bar-demo»; `analytics-metrics.int.test.ts` › «el local de otro negocio es 404 …»; `e2e/auth.spec.ts` › «aislamiento entre negocios» | INT + E2E (host completo) | PENDIENTE de corrida final |
| T14 | Otro negocio en el host Core + Commerce | **sin prueba** específica (lo cubre `permissions-matrix` en el host completo). | — | PENDIENTE (sin prueba) |
| — | Separabilidad estática (MOD-11) | `scripts/separability.test.mjs` (`pnpm exec vitest run scripts/separability.test.mjs`); `pnpm check:separability` | UNIT + script | PENDIENTE de corrida final |

## Negativos (MOD-71)

| Caso | Evidencia | Estado |
|---|---|---|
| Sin sesión, cookie inventada, vencida o revocada → 401 | `permissions-matrix.int.test.ts` › «anónimo, cookie inventada, vencida o revocada -> 401 …» | PENDIENTE de corrida final |
| Rol sin permiso en su local → 403 | `permissions-matrix.int.test.ts` › «rol sin el permiso, en su propio local -> 403»; `core-commerce.int.test.ts` › zapatería (`vendedor` staff → 403 `permission_denied`) | PENDIENTE de corrida final |
| Módulo no contratado → 403 `module_disabled` | filas T12 | PENDIENTE de corrida final |
| `/me` sin permisos de módulos ausentes ni métricas sin fuente (MOD-25) | `get-me.test.ts` (4 casos); `users.int.test.ts` › «roles por local: se reemplazan y se reflejan en /me …» | PENDIENTE de corrida final |
| Solo superadmin habilita módulos; módulo desconocido 400 | `core-commerce.int.test.ts` › T11 (`inventario` → 403; `desconocido` → 400); `platform.test.ts` › «SetModuleEnabled …» | PENDIENTE de corrida final |
| URL forzada en el portal vuelve al inicio | `routes.test.tsx` › «pantalla no permitida por URL vuelve al inicio»; `inventory-only.spec.ts`, `hospitality-only.spec.ts` | PENDIENTE de corrida final |
| La API también lo niega (no solo la UI) | `inventory-only.spec.ts` (403 a mesas y métricas); `hospitality-only.spec.ts` (403 a productos) | PENDIENTE de corrida final |
| Origin ajeno en mutación → 403 | `permissions-matrix.int.test.ts` › «Origin ajeno en una mutación …»; `users.int.test.ts` › «Origin ajeno en una mutación -> 403» | PENDIENTE de corrida final |
| Rutas de gateway solo con su clave | `permissions-matrix.int.test.ts` › «rutas del gateway: solo la clave del gateway, no la sesión» | PENDIENTE de corrida final |

## Fallos e integración (MOD-72; parte de T13 de esta rama)

| Caso | Evidencia | Estado |
|---|---|---|
| Analytics caído no bloquea llamados; al volver se pone al día | `apps/api/src/e2e/analytics-isolation.int.test.ts` | PENDIENTE de corrida final |
| Analytics caído no bloquea un movimiento de stock; entrega diferida una sola vez y reentrega sin duplicar | `apps/api/src/e2e/commerce-analytics-isolation.int.test.ts` | PENDIENTE de corrida final |
| Reintento con espera creciente | `domains/{hospitality,commerce}/api/src/infrastructure/outbox/outbox-poller.int.test.ts` › «suscriptor que falla …» | PENDIENTE de corrida final |
| Tope de 10 intentos → `failed_at`; `retryFailed` lo libera | `domains/hospitality/api/src/infrastructure/outbox/outbox-poller.int.test.ts` › «tras maxAttempts fallos queda con failed_at …» | PENDIENTE de corrida final |
| Sin suscriptores → despachado | ídem › «solo entrega a quien dice manejar el tipo; con cero suscriptores …»; commerce › «dos pollers en paralelo … y sin suscriptores igual se despacha» | PENDIENTE de corrida final |
| Reinicio a mitad de lote | hospitality `outbox-poller.int.test.ts` › «al reiniciar retoma los pendientes …»; `e2e/service-call.spec.ts` (reconexión tras reiniciar la API) | PENDIENTE de corrida final |
| Suscriptor colgado (timeout) | `domains/core/contracts/src/outbox-poller.test.ts` (2); hospitality `outbox-poller.int.test.ts` › «suscriptor que no responde …» | PENDIENTE de corrida final |
| Deduplicación por `event_id` | `location-events.int.test.ts`, `platform-audit.int.test.ts`, `commerce-analytics-isolation.int.test.ts`, `location-created.subscriber.test.ts` | PENDIENTE de corrida final |
| Reconstrucción de analytics | `apps/api/src/e2e/analytics-rebuild.int.test.ts` (3) | PENDIENTE de corrida final |
| `ready` 503 con la base caída | `apps/api/src/e2e/health.int.test.ts` | PENDIENTE de corrida final |
| Log `outbox.failed_pending` de `/health/ready` | **sin prueba** | PENDIENTE (sin prueba) |
| Un suscriptor que falla reintenta el evento para todos | **sin prueba** dedicada (comportamiento documentado en `OutboxPoller.deliver`) | PENDIENTE (sin prueba) |

## Otra rama / posterior (PLAN-003 §4)

| ID | Dónde |
|---|---|
| T02 Core + POS | otra rama (`pos/mesas`) |
| T08 Hospitality + POS | otra rama (`pos/mesas`) |
| T03 POS + Inventario | posterior (`feature/pos-inventory`) |
| T04 POS + Analytics | posterior (`feature/pos-analytics`) |
| T06 POS + Inventario + Analytics | posterior |
| T10 Suite de cuatro productos | posterior |
| T11-POS, T12-POS, T13-POS, T14-POS | otra rama (`pos/mesas`) |
| T15 Analytics-only | posterior: no certificar sin fuente externa real |
