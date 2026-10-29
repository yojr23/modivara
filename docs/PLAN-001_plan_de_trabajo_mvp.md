# PLAN-001 — Plan de trabajo del MVP (fases 1 a 6 y hito «demo mostrable»)

> **Proyecto:** Emprendimiento — plataforma SaaS modular (Modivara, nombre candidato)  
> **Fecha:** 19 de octubre de 2026  
> **Estado:** propuesta para revisión. No es un ADR ni modifica ningún documento existente.  
> **Precedencia:** `ADR-003` (§17; planos y tablero) > `ADR-002` > `ADR-001` > `TECH-001` v1.7 (§5, §12, §16) > `DATA-001` > `BRAND-002` (§11). Este plan solo ordena y divide el trabajo; si contradice alguno de ellos, manda el documento.  
> **Origen:** `HANDOFF.md` §3 T8.  
> **Convenciones:** tamaño **S** = medio día, **M** = un día. Sin fechas de calendario. Rutas relativas a la raíz del repo `modivara/`; `<d>` = `core | hospitality | commerce | analytics`. «Api» = `domains/<d>/api/src/{domain,application,infrastructure,presentation}`.  
> **Marca `[DISEÑO]`:** la tarea es de UI y **requiere revisión de diseño con el responsable** antes de construirse (y antes de darse por cerrada). Sin ese visto bueno no se escriben pantallas reales.

## 0. Fase 0 — esqueleto (sesión nocturna)

> **Estado 20/10/2026 (rama `fase-0/esqueleto`, 41 commits):** hecha. Todo lo de la tabla quedó verificado (339 pruebas, `docker compose up` OK); detalle en `NOCHE-LOG.md`. La tabla de abajo se conserva como estaba escrita antes de la sesión.

Descrito como **esperado**, no como resultado verificado. La verdad está en `NOCHE-LOG.md` y en `git log` de la rama `fase-0/esqueleto`; al abrir la Fase 1 hay que comprobar cada punto con `pnpm typecheck && pnpm test && pnpm build && pnpm check:separability`.

| Esperado de la sesión nocturna | Dónde debería estar |
|---|---|
| Workspace pnpm, TypeScript `strict`, Vitest, versiones exactas | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` |
| Separabilidad (ADR-002 D1): `exports` solo a `index.ts` y script que falla ante violaciones | `scripts/`, `pnpm check:separability` |
| Dominio y casos de uso **sin base de datos** de `core`, `hospitality`, `commerce` y `analytics`, con puertos (Repository por agregado, `CoreAccessPort`, `IoTInputPort`, `NotificationPort`, `EventPublisherPort`) y dobles en memoria en `src/**/testing/` | `domains/<d>/api/src/{domain,application}` |
| Contratos Zod (permisos, contraseña/usuario/slug, eventos v1, mensaje del gateway) | `domains/<d>/contracts/src` |
| Base visual del portal (tokens de BRAND-002 §9, fuentes, página interna `/_tokens`) | `apps/portal` |
| Docker: `docker-compose.yml` (db, mqtt, api, web, button-sim, caddy) y Dockerfiles multietapa | raíz y `apps/*` |
| `schema.prisma` solo con `generator` y `datasource`; **sin migraciones** | `domains/<d>/api/.../schema.prisma` |

**Supuesto de este plan:** los puertos de repositorio y los casos de uso existen con las firmas que Fase 0 dejó. Cada tarea «Prisma» *implementa el puerto existente*; si la firma no sirve, se ajusta el puerto con su prueba, no se esquiva. Los nombres de archivo de abajo son orientativos y se alinean con lo que haya quedado.

## 1. Primera tarea bloqueante — revisión de DATA-001

> **Estado 20/10/2026: P0-01 cerrada.** Respuestas del responsable: (1) slug 3–40 y username 3–32 confirmados; (2) orden por `position`; (3) catálogo **por local**. DATA-001 v1.1 recoge además el puerto transaccional acotado, `core.audit_log`, `location_inactive`, ids generados en la app y las FK compuestas. Las tareas de F4 que asumían catálogo por negocio deben leerse con `products.location_id`.

Ninguna migración, modelo Prisma ni tarea de infraestructura de base de datos (`F1-01` en adelante) empieza antes de cerrar esto.

| ID | Tarea | Entregable | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| **P0-01** | Revisión de DATA-001 con el responsable: resolver las 3 preguntas de §8 y cualquier ajuste que surja de las preguntas de §6 de este plan | Decisiones anotadas (versión nueva de DATA-001 o nota de decisión; **no editar** el actual sin pedirlo) | Las 3 preguntas tienen respuesta escrita; DATA-001 marcado «revisado» | — | M |

**Las 3 preguntas de DATA-001 §8** (con la alternativa más barata de revertir, para decidir rápido):

| # | Pregunta | Propuesta actual | Impacto si se cambia después de migrar |
|---|---|---|---|
| 1 | Longitud y formato de `slug` y `username` | slug 3–40, username 3–32 (`CHECK` en `core`) | Bajo: ampliar un `CHECK` es una migración corta. Reducir puede invalidar datos. Conviene decidir antes: el slug nunca se reutiliza. |
| 2 | ¿Basta `position` en mesas y zonas para ordenar el tablero, o se ordena por `label` con orden natural? | Columna `position` | Medio: quitar `position` o añadirla toca UI de administración (reordenar) y consultas. Natural sort por `label` se resuelve en la consulta/cliente, sin columna. |
| 3 | ¿Catálogo de productos por negocio o por local? | Por negocio (`products.organization_id`), saldos por local | Alto: cambia llaves únicas, saldos, motivos y el seed. Decidir antes de F4. |

**Cómo se desbloquea:** `P0-01` cerrada → se permite `prisma migrate` y modelos en `schema.prisma` (hoy prohibidos por `AGENTS.md`; actualizar esa línea al cerrar `P0-01`).

## 2. Cómo se escribe cada fase (reglas comunes)

- **Orden dentro de un dominio:** migración (SQL explícito) → repositorio Prisma que implementa el puerto → prueba de integración contra PostgreSQL real → controlador/guard → cliente web → E2E.
- **Migraciones:** `prisma migrate dev --create-only` por dominio, luego se **edita el SQL a mano** para lo que Prisma no expresa (`uuidv7()` por defecto, índices parciales, `CHECK`, `NULLS NOT DISTINCT`, FK compuestas, `CREATE TYPE`). Cada migración con una prueba que intenta violar cada restricción.
- **Pruebas de integración:** carpeta `*.int.test.ts` por dominio, contra el servicio `db` de `docker compose` (base `modivara_test`, esquema por dominio), comando `pnpm test:integration`. Se crea en `F1-02` y todos los dominios la reutilizan. Las pruebas de dominio/aplicación siguen sin base de datos.
- **Cada tarea** termina con `pnpm typecheck`, `pnpm test`, `pnpm check:separability` en verde, más su criterio propio. Un commit Conventional por tarea.
- **Repositorios:** persisten agregado, transiciones y eventos pendientes de outbox en **una sola transacción** (TECH-001 §5). Nada de tenant tomado del cliente (DATA-001 §1).
- **Guards:** todo endpoint lleva `@RequirePermission(...)`; los de módulo, además `ModuleEnabledGuard`. Lista de permisos en `domains/core/contracts/src/permissions.ts`.

---

## 3. Fase 1 — Tenant, local, identidad, permisos y acceso al portal

Resultado verificable (TECH-001 §12): **aislamiento real en backend**.

> **Estado 20/10/2026 (rama `fase-1/identidad`):** F1-01 a F1-13 hechas y verificadas (pruebas unitarias e integración contra PostgreSQL real, demo en Docker con seed y login). Pendientes: **F1-14 y F1-15 `[DISEÑO]`** (requieren tu revisión) y **F1-16** (E2E, depende de F1-14). Desvío respecto del plan: las migraciones se generan con `pnpm migration:new` (diff contra la base viva) en vez de `prisma migrate dev`, porque el rol del dominio no tiene CREATEDB.
>
> **27/10/2026 (rama `fase-5/metricas`):** `core-web` ya tiene cliente y hooks de administración de usuarios (`useUsers`, `useCreateUser`, `useResetPassword`, `useDeactivateUser`, `useSetLocationRoles`, `useRevokeUserSessions`): F1-15 solo necesita la pantalla.

| ID | Tarea | Archivos / paquetes | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| F1-01 | Modelo Prisma + migración `core` (DATA-001 §2): enums, organizaciones, locales, usuarios, membresías, sesiones, entitlements. SQL explícito: `uuidv7()`, `uq_organizations_single_platform`, `uq_*` parciales, `CHECK` de slug/username, FK compuestas | `domains/core/api/.../prisma/{schema.prisma,migrations/}` | `prisma migrate deploy` sobre base vacía OK. Prueba SQL: duplicar slug, segunda org de plataforma, usuario de otra org en membresía y `roles` vacío fallan | P0-01 | M |
| F1-02 | Infra de pruebas de integración: servicio `db` de pruebas, `pnpm test:integration`, utilidad que migra y limpia por esquema, aislamiento entre pruebas | `vitest.config.ts` (proyecto integración), `docker-compose.yml` (perfil test), `scripts/` | `pnpm test:integration` levanta, migra y corre una prueba de humo contra PostgreSQL 18 real; falla claro si Docker no está | F1-01 | S |
| F1-03 | Repositorios Prisma de `core` que implementan los puertos existentes: `OrganizationRepository`, `LocationRepository`, `UserRepository` (incluye membresías) | `domains/core/api/src/infrastructure/prisma-*.repository.ts` | Pruebas de integración: alta, búsqueda por `(org, username)`, desactivar libera el `username`, el slug no se reutiliza tras desactivar | F1-02 | M |
| F1-04 | `SessionRepository` Prisma + adaptador de hash Argon2id (`PasswordHasherPort`) + generación/`SHA-256` de token de sesión | `infrastructure/prisma-session.repository.ts`, `infrastructure/argon2-hasher.ts` | Integración: crear, resolver por `token_hash`, deslizar `expires_at` máx. 1 vez/hora, revocar. Unitaria: el token en claro nunca se persiste | F1-03 | S |
| F1-05 | Casos de uso de login conectados: bloqueo 5 fallos/15 min por usuario+negocio, revocación de sesiones al cambiar contraseña o desactivar usuario | `application/*` (ya existentes) + `infrastructure` | Integración: 5 fallos → bloqueo; el 6.º con contraseña correcta rechazado hasta que pasa la ventana (temporizadores falsos); cambiar contraseña deja 0 sesiones activas | F1-04 | M |
| F1-06 | Controladores de auth: `POST /api/v1/auth/login` (slug + usuario + contraseña), `logout`, `GET /me`. Cookie `HttpOnly; Secure; SameSite=Strict`, guard de `Origin` en mutaciones, límite por IP | `domains/core/api/src/presentation/auth.controller.ts`, `origin.guard.ts` | Prueba HTTP (supertest sobre Nest): login OK fija cookie; `Origin` ajeno → 403; 429 por IP; mensaje de error idéntico para usuario inexistente y contraseña errónea | F1-05 | M |
| F1-07 | Guards: `SessionGuard` (resuelve contexto autorizado en servidor), `PermissionGuard` + decorador `@RequirePermission`, `ModuleEnabledGuard` (lee `entitlements`) | `presentation/guards/*`; exporta decoradores por `core-contracts`/`index.ts` para que otros dominios los usen sin importar internos | Unitarias de cada guard; superadmin pasa sin membresía ni entitlement; `staff` sin `core.users.manage` recibe 403; módulo deshabilitado → 403 | F1-06 | M |
| F1-08 | Implementación en proceso de `CoreAccessPort` (existencia de local, zona horaria, entitlements, membresías) y registro en `CoreModule` | `core/api/src/infrastructure/core-access.adapter.ts`, `core.module.ts` | Integración: devuelve la zona horaria del local; local ajeno o desactivado → `null`/error de dominio; probada desde `hospitality-api` solo con el tipo de `core-contracts` | F1-03 | S |
| F1-09 | API de administración de negocio: usuarios (alta, reset de contraseña, desactivar, roles por local) y membresías, con `core.users.manage` | `presentation/users.controller.ts` | Integración HTTP: `admin` crea `staff`; `staff` no; admin de org A no ve usuarios de org B; contraseña débil rechazada con el esquema Zod | F1-07 | M |
| F1-10 | Auditoría de superadmin: toda acción con `acting_organization_id` registra usuario; endpoint para «operar sobre el negocio X» | `core/api` (sesión + caso de uso `ActAsOrganization`) | Integración: sesión superadmin con `acting_organization_id` accede a datos del negocio; sin él no; la acción queda con `app_users.id` | F1-07 | S |
| F1-11 | Seed parcial de `core` por casos de uso: org `labs` + superadmin, `bar-demo` (admin, barra, mesero1, inventario1), `bar-demo-pisos`, entitlements | `scripts/seed/core.ts` (usa solo servicios de dominio vía `index.ts`) | `pnpm seed:core` idempotente (dos corridas = mismo estado); login real con cada usuario | F1-09 | S |
| F1-12 | Prueba de aislamiento multi-tenant (integración, la «prueba de fuego» de la fase) | `core/api/src/**/isolation.int.test.ts` | Usuario de `bar-demo` no obtiene datos de `bar-demo-pisos` por ningún endpoint de F1; slug reservado (`labs`, `api`, `sim`, …) rechazado al crear negocio | F1-11 | S |
| F1-13 | Portal — arquitectura de sesión (sin visuales): cliente API, TanStack Query, `AuthProvider`, rutas protegidas, navegación armada con los entitlements que devuelve `/me` | `apps/portal/src/{app,lib,routes}`, `domains/core/web/src` | Pruebas Vitest + Testing Library: sin sesión redirige a `/<slug>`; módulo no habilitado no aparece; 401 limpia sesión | F1-06 | M |
| F1-14 | **`[DISEÑO]`** Pantalla de login por negocio (`/<slug>`) | `domains/core/web/src/login`, `apps/portal` | Revisión de diseño aprobada; teclado y lector de pantalla; contraste WCAG; E2E de F1-16 en verde | F1-13 | M |
| F1-15 | **`[DISEÑO]`** Shell del portal (layout, navegación, tema claro/oscuro) y pantalla de usuarios del negocio | `apps/portal/src/ui`, `domains/core/web/src/users` | Revisión de diseño aprobada; alta de usuario desde la UI contra la API real | F1-13, F1-09 | M |
| F1-16 | Playwright: configuración + E2E «login correcto, login erróneo, bloqueo, logout, aislamiento entre negocios» | `e2e/` (raíz) o `apps/portal/e2e`, `docker compose` de pruebas | `pnpm test:e2e` verde contra el stack local con `seed:core` | F1-14 | M |

**Cierre de fase:** `F1-12` y `F1-16` verdes. **Total: 16 tareas.**

---

## 4. Fase 2 — Mesas, zonas, dispositivos, asignaciones y simulador

Resultado (TECH-001 §12): reglas de estado y de solicitud activa **probadas**; flujo completo demostrable sin hardware.

> **Estado 21/10/2026 (rama `fase-2/mesas`):** backend hecho: F2-01…F2-09, F2-11, F2-12, la parte de backend de F2-15 (prueba de punta a punta con guards reales) y el seed de hospitality (DATA-001 §7). Pendientes: **F2-10, F2-13, F2-14 `[DISEÑO]`** y el E2E de navegador de F2-15. F2-08 resuelto por defecto en lectura (sin fila de `location_settings` valen los valores por defecto); **completado el 25/10 en la rama de Fase 4**: hospitality crea `location_settings` al recibir `core.location.created.v1` (Q-05 cerrada). Auditoría de acciones de plataforma en hospitality: **pendiente de decisión** (ADR-002 D3). En este plan, F2 cubre la configuración (mesas, zonas, gateways, botones, asignaciones) y el simulador; el camino de pulsación persistido y en tiempo real es F3.

| ID | Tarea | Archivos / paquetes | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| F2-01 | Modelo Prisma + migración `hospitality` completa (DATA-001 §3 y outbox §6): enums, `location_settings`, zonas, mesas, gateways, dispositivos, asignaciones, `service_calls`, transiciones, `device_events`, `outbox_events`. SQL explícito: `uq_service_calls_active` parcial, `CHECK` de coherencia estado/fechas, `uq_dining_tables_label` con `NULLS NOT DISTINCT`, `uq_device_assignments_active`, FK compuestas `(x_id, location_id)` | `domains/hospitality/api/.../prisma/` | Migración OK en base vacía. Prueba SQL por restricción: mesa duplicada en misma zona falla y en zonas distintas pasa; dos asignaciones activas del mismo botón fallan; `status='in_progress'` sin `acknowledged_at` falla; dos llamados activos de la misma mesa y tipo fallan | P0-01, F1-02 | M |
| F2-02 | Repositorios Prisma `ZoneRepository` y `DiningTableRepository`; validación del `location_id` vía `CoreAccessPort` al crear | `hospitality/api/src/infrastructure/prisma-{zone,dining-table}.repository.ts` | Integración: orden por `position` (o el criterio decidido en P0-01 #2); desactivar libera la etiqueta; local de otra org rechazado | F2-01, F1-08 | M |
| F2-03 | `DeviceRepository` + `DeviceAssignmentRepository`: asignar, reasignar y desasignar en una transacción, conservando historial | `infrastructure/prisma-device*.repository.ts` | Integración: reasignar cierra la asignación previa y abre la nueva (`unassigned_by` coherente); un botón nunca en dos mesas; una mesa con 3 botones OK; la resolución «¿qué mesa tenía el botón en el instante T?» devuelve la vigente en T | F2-01 | M |
| F2-04 | `GatewayRepository` + generación de clave (se muestra **una sola vez**, se guarda `SHA-256`) + actualización de `last_seen_at` | `infrastructure/prisma-gateway.repository.ts`, caso de uso de alta | Integración: la clave en claro no existe en base; verificación por hash; clave inválida no autentica | F2-01 | S |
| F2-05 | Controladores `zones` y `tables` (`GET/POST/PATCH`, desactivar) con `hospitality.tables.manage` + `ModuleEnabledGuard('hospitality')` | `hospitality/api/src/presentation/{zones,tables}.controller.ts`, DTOs Zod | HTTP: `admin` crea; `staff` 403; módulo off 403; mesa de otro local 404; mismo número en zonas distintas OK | F2-02, F1-07 | M |
| F2-06 | Endpoint de estado para admin de local: «¿tiene botón?» y «¿conectado?» (`hospitality.devices.status`), sin exponer datos técnicos | `presentation/devices-status.controller.ts` | HTTP: `admin`/`staff` ven booleanos por mesa; ninguna respuesta contiene `code`, `key_hash` ni `gateway_id` (prueba que lo asegura) | F2-03, F2-04 | S |
| F2-07 | API de plataforma (solo superadmin, `platform.*`): crear gateway, listar «detectados sin asignar», crear dispositivo, asignar botón↔mesa | `presentation/platform-*.controller.ts` | HTTP: admin de negocio recibe 403; superadmin con `acting_organization_id` opera; acción auditada con su usuario | F2-03, F2-04, F1-10 | M |
| F2-08 | Suscripción del tenant: creación de `location_settings` y de los datos por defecto al crear un local (ver pregunta Q-05 sobre cómo se dispara entre dominios) | `hospitality/api/src/application` | Prueba: tras crear un local por el seed, existe `location_settings` con `call_visibility='all'` | F2-01, Q-05 | S |
| F2-09 | **Simulador `button-sim` funcional**: servidor Node que sirve la página, mantiene lista de mesas/botones simulados, y envía pulsaciones por **HTTP** (header de clave de gateway) o **MQTT** (tópico `modivara/gw/<gateway_id>/press`, usuario por gateway), seleccionable por variable/parámetro; envía heartbeat cada 30 s; respeta el contrato Zod de `hospitality-contracts` | `apps/button-sim/src/{server,http-sender,mqtt-sender,heartbeat}.ts` | Pruebas Vitest con servidor HTTP falso y broker MQTT en memoria/contenedor: cada pulsación sale con el cuerpo y headers correctos, el heartbeat sale cada 30 s (temporizadores falsos), el simulador no importa código interno de dominios (separabilidad) | Fase 0 | M |
| F2-10 | **`[DISEÑO]`** Página del simulador pensada para celular: un botón por mesa, selección HTTP/MQTT, indicador de envío/error | `apps/button-sim/src/ui` | Revisión de diseño aprobada; usable con el pulgar en 360 px; estado de envío siempre visible (color + icono + texto) | F2-09 | S |
| F2-11 | Mosquitto configurable: `mosquitto.conf`, `passwd` y ACL `pattern write modivara/gw/%u/#`; script para crear/rotar un usuario por gateway | `docker/mosquitto/*`, `scripts/mqtt-user.sh`, `docker-compose.yml` | Con el contenedor arriba: el usuario del gateway A publica en su tópico y **no** en el del B (prueba con cliente MQTT) | Fase 0 | S |
| F2-12 | Cliente web de hospitality para configuración: hooks TanStack Query de mesas/zonas/estado de botones | `domains/hospitality/web/src/api` | Vitest con MSW (o fetch simulado): errores 403/409 se traducen a estados de UI tipados | F2-05 | S |
| F2-13 | **`[DISEÑO]`** Administración de mesas y zonas (alta, edición, desactivar, ordenar, indicador «tiene botón / conectado») | `domains/hospitality/web/src/tables` | Revisión de diseño aprobada; crear mesa repetida en otra zona funciona; accesibilidad por teclado | F2-12 | M |
| F2-14 | **`[DISEÑO]`** Consola de superadmin, parte 1: negocios y locales (lectura), gateways con clave mostrada una vez, «detectados sin asignar», vinculación botón↔mesa | `apps/portal/src/platform`, `domains/hospitality/web/src/platform` | Revisión de diseño aprobada; la clave del gateway se copia una sola vez y desaparece al cerrar | F2-07 | M |
| F2-15 | E2E: superadmin crea gateway y botón, admin crea mesa y zona, superadmin vincula; admin ve «tiene botón» | `e2e/hospitality-config.spec.ts` | `pnpm test:e2e` verde; un `admin` no puede abrir la consola de plataforma por URL directa | F2-13, F2-14 | M |

**Cierre de fase:** F2-01, F2-03 (reglas contra PostgreSQL) y F2-15 verdes. **Total: 15 tareas.**

---

## 5. Fase 3 — Adaptador de hardware, persistencia, Outbox, tiempo real y reconexión

Resultado (TECH-001 §12): **pulsación trazable de extremo a extremo** (simulada hoy, hardware real después).

> **Estado 22/10/2026 (rama `fase-3/tiempo-real`):** backend hecho: F3-01…F3-12 (ingesta HTTP y MQTT, concurrencia con 20 corridas, API de llamados, poller de outbox, Socket.IO, salud de gateways, cliente de tiempo real) más correcciones de seguridad (límites por gateway, mensajes retenidos, cursor). Demo verificada en Docker: simulador por HTTP y MQTT → llamado → reconocer → finalizar → historial; botones `all_connected` con la señal de vida. Pendientes: **F3-13, F3-14, F3-15 `[DISEÑO]`** y F3-16 (E2E de navegador, depende de F3-13).
>
> **27/10/2026 (rama `fase-5/metricas`), soporte de F3-14:**
> - Nuevo detalle de un llamado: `GET /api/v1/locations/:locationId/service-calls/:callId`, con permiso `hospitality.calls.read` y `canSeeCall`. Devuelve el llamado más `transitions` (acción, estados, `occurred_at`, `actor_user_id`, `actor_name`, `device_event_id`), ordenadas por fecha.
> - Los llamados, en el listado, el detalle, reconocer/finalizar y el tiempo real, traen `acknowledged_by_name` y `completed_by_name`. Los nombres los resuelve core con `CoreAccessPort.userDisplayNames`, sin lecturas entre esquemas.
> - Hooks `useCallHistory` (paginado) y `useCallDetail`.
> - F3-14 solo necesita la pantalla.

| ID | Tarea | Archivos / paquetes | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| F3-01 | `ServiceCallRepository` Prisma: inserción atómica `INSERT … ON CONFLICT (table_id, call_type) WHERE status IN (...) DO UPDATE` con `RETURNING (xmax = 0) AS created`; reconocer/finalizar con `UPDATE … WHERE status = …`; transiciones y `outbox_events` en la **misma transacción** | `hospitality/api/src/infrastructure/prisma-service-call.repository.ts` | Integración: primera pulsación crea + transición `create` + evento `created.v1`; segunda suma `press_count`, **sin** nueva transición ni evento; `acknowledge` sobre ya reconocido devuelve 0 filas | F2-01 | M |
| F3-02 | `DeviceEventRepository` y registro de resultados: `call_created`, `repeat_press`, `debounced`, `unknown_device`, `unassigned_device` | `infrastructure/prisma-device-event.repository.ts` | Integración: cada rama deja exactamente un `device_event` con `correlation_id`; `unknown_device` sin más efectos | F2-01 | S |
| F3-03 | Cableado del caso de uso `RegisterButtonPress` de infraestructura: `pg_advisory_xact_lock` por `device_id`, ventana `debounced` de 3 s (constante `DEBOUNCE_MS`), resolución de asignación vigente | `application/register-button-press.use-case.ts` (existente) + adaptador | Integración con temporizadores falsos: dos señales a 1 s → la segunda `debounced` y `press_count` no cambia; a 4 s → `repeat_press` | F3-01, F3-02, F2-03 | M |
| F3-04 | **Prueba de concurrencia de llamados** (PostgreSQL real): N pulsaciones simultáneas de botones distintos de la misma mesa; misma señal del mismo botón en paralelo; dos usuarios reconociendo a la vez; reconocer y finalizar cruzados | `hospitality/api/src/**/concurrency.int.test.ts` | Con N=20 en paralelo (`Promise.all`): exactamente 1 `service_calls` activa, `press_count` correcto, 1 transición `create`, 1 evento `created`; en doble reconocimiento: uno OK, otro recibe el conflicto con 409 y el estado actual. Repetida 20 veces sin fallar | F3-03 | M |
| F3-05 | Adaptador **HTTP** del gateway: `POST /api/v1/device-events`, `POST /api/v1/gateways/heartbeat`; guard por clave en header; organización/local/gateway deducidos de la clave; implementa `IoTInputPort` | `infrastructure/iot/http.adapter.ts`, `presentation/gateway-key.guard.ts`, `device-events.controller.ts` | HTTP: clave inválida 401; cuerpo con `organization_id` enviado por el cliente **ignorado** (prueba explícita); mensaje inválido 400 con Zod; heartbeat actualiza `last_seen_at` | F3-03, F2-04 | M |
| F3-06 | Adaptador **MQTT**: suscripción a `modivara/gw/+/press` y `…/heartbeat`; gateway deducido del usuario/tópico; implementa el mismo `IoTInputPort` | `infrastructure/iot/mqtt.adapter.ts` | Integración con Mosquitto del compose: el mismo mensaje por HTTP y por MQTT produce el mismo resultado; tópico de otro gateway no se acepta; reconecta si el broker cae (prueba reiniciando el contenedor) | F3-03, F2-11 | M |
| F3-07 | Traducción tecla→`call_type` en el adaptador según `devices.model` (un único tipo `attention` en el piloto); sin lógica de tipo en el dominio | `infrastructure/iot/key-map.ts` | Unitaria: tecla desconocida → `attention` por defecto o rechazo, según Q-08; el dominio no importa el mapa | F3-05 | S |
| F3-08 | Controladores de llamados: `GET /locations/:id/service-calls?status=active`, historial paginado, `POST …/acknowledge`, `POST …/complete`; `canSeeCall(user, call)` en toda consulta | `presentation/service-calls.controller.ts`, `application/can-see-call.ts` | HTTP: `inventory` 403; `staff` ve todos los del local; local ajeno 404; reconocer ya reconocido → 409 con el estado actual; `Idempotency-Key` repetida devuelve el mismo resultado | F3-01, F1-07 | M |
| F3-09 | **Poller de outbox** en el mismo proceso: lotes con `FOR UPDATE SKIP LOCKED`, entrega a suscriptores registrados vía `EventPublisherPort`, `dispatched_at`, `attempts`, espera creciente en `next_attempt_at`; no borra eventos | `hospitality/api/src/infrastructure/outbox/outbox-poller.ts` (patrón replicable en `commerce`) | Integración: evento publicado tras commit; suscriptor que falla 2 veces se reintenta con espera creciente y a la tercera se despacha; dos pollers en paralelo no duplican entrega (`SKIP LOCKED`); el proceso al reiniciar retoma pendientes | F3-01 | M |
| F3-10 | **Socket.IO** en Hospitality: autenticación con la misma cookie de sesión, salas por `organization_id/location_id` del servidor, `NotificationPort` → emisión **directa tras el commit** (sin esperar al poller), filtrado por `canSeeCall` | `infrastructure/realtime/socket.gateway.ts` | Integración con cliente `socket.io-client`: usuario del local A recibe la nueva solicitud; usuario del local B **no**; conexión sin cookie rechazada; `Origin` ajeno rechazado | F3-08 | M |
| F3-11 | Señal de estado de botones: tarea periódica que detecta gateways con más de 90 s sin señal y emite «Botones desconectados»/«reconectados» a la sala | `infrastructure/realtime/gateway-health.ts` | Prueba con temporizadores falsos: a 91 s emite una vez (no repite en cada ciclo); al volver el heartbeat emite recuperación | F3-05, F3-10 | S |
| F3-12 | Cliente de tiempo real en el portal: `socket.io-client` con reconexión, indicador de estado de conexión, **al reconectar invalidar consultas y releer por REST**; hook `useActiveCalls` | `domains/hospitality/web/src/realtime` | Vitest con servidor Socket.IO falso: tras cortar y restaurar, se dispara una relectura REST y la lista converge; el estado de conexión cambia visiblemente | F3-10 | M |
| F3-13 | **`[DISEÑO]`** Tablero de barra (tema oscuro, tablet primero). **Reemplazado por L-06 (ADR-003): plano operativo + cola global; la cuadrícula queda solo como alternativa en lista.** Texto original: cuadrícula de mesas legible a distancia, llamado pendiente destacado con tiempo transcurrido (ámbar 2 min, rojo 5 min), reconocer y finalizar con un toque, estado de conexión y «Botones desconectados» siempre visibles, alerta sonora opcional activada por el usuario | `domains/hospitality/web/src/board` | Revisión de diseño aprobada; estado nunca solo por color; `prefers-reduced-motion` respetado; contraste WCAG | F3-12 | M |
| F3-14 | **`[DISEÑO]`** Historial de llamados (filtros por fecha, mesa, estado; detalle con transiciones y actores) | `domains/hospitality/web/src/history` | Revisión de diseño aprobada; muestra `press_count` y quién reconoció/cerró | F3-08 | S |
| F3-15 | **`[DISEÑO]`** Consola de superadmin, parte 2: eventos recientes de dispositivos, `unknown_device`, estado de gateways | `apps/portal/src/platform`, `hospitality/web/src/platform` | Revisión de diseño aprobada; un botón no registrado aparece en la consola y en ningún otro lugar | F3-02, F2-14 | M |
| F3-16 | **E2E del flujo central**: simulador (HTTP y luego MQTT) → registro → tablero → reconocer → finalizar → historial; reconexión; sustitución de botón; aislamiento entre locales | `e2e/service-call-flow.spec.ts` | `pnpm test:e2e` verde en ambos transportes; tras `docker compose restart api` el tablero recupera el estado vigente | F3-13, F2-09 | M |

**Cierre de fase:** F3-04, F3-06 y F3-16 verdes. **Total: 16 tareas.**

---

## 6. Fase 4 — Inventario básico (`commerce`)

Resultado (TECH-001 §12): **inventario básico con historial auditable**.

> **Estado 27/10/2026 (rama `fase-4/inventario`, 14 commits sobre `fase-3/tiempo-real`, hechos el 25/10):** backend hecho: F4-01…F4-08 (migración con restricciones, repositorios, libro de stock con saldo bloqueado y ajuste por conteo, concurrencia de saldos con 20 corridas, outbox con eventos validados, API HTTP con `Idempotency-Key` en el header, cliente web) y `seed:commerce`. Transversal en la misma rama: un solo poller de outbox en `core-contracts`, con tope de 10 intentos (`failed_at`) y `pnpm outbox:retry`; outbox de `core` con `core.location.created.v1`, al que se suscriben commerce (motivos y lugar «Principal») y hospitality (`location_settings`). Eso cierra Q-05, F2-08 y el disparador de F4-02. Pendientes: **F4-09 y F4-10 `[DISEÑO]`**, y F4-11 (E2E, depende de F4-09). Donde las tareas dicen «catálogo de otra org», léase «de otro local» (catálogo por local, P0-01 #3).

| ID | Tarea | Archivos / paquetes | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| F4-01 | Modelo Prisma + migración `commerce` (DATA-001 §4 y outbox): productos, lugares de stock, motivos, saldos, movimientos. SQL explícito: `CHECK (quantity >= 0)`, `CHECK` de signo de `delta` por dirección, FK `(reason_id, direction)`, `UNIQUE (organization_id, idempotency_key)`, índices parciales | `domains/commerce/api/.../prisma/` | Migración OK. Prueba SQL: saldo negativo, `delta` con signo equivocado y motivo de otra dirección fallan | P0-01 (#3), F1-02 | M |
| F4-02 | Repositorios `ProductRepository`, `StockLocationRepository`, `MovementReasonRepository` + siembra de motivos por negocio y del lugar «Principal» (disparador: ver Q-05) | `commerce/api/src/infrastructure/*` | Integración: nombre y SKU únicos solo entre activos; un solo lugar por defecto activo por local; motivos sembrados según DATA-001 §4 | F4-01, Q-05 | M |
| F4-03 | `StockMovementRepository`: asegura fila de saldo, aplica `UPDATE … quantity + $delta` atómico, inserta movimiento con `balance_after`, escribe outbox, idempotencia por `Idempotency-Key`; **no** usa `INSERT … ON CONFLICT DO UPDATE` con el delta | `infrastructure/prisma-stock-movement.repository.ts` | Integración: entrada, salida y ajuste correctos; salida que dejaría negativo se rechaza **sin dejar movimiento ni evento**; clave repetida devuelve el movimiento original | F4-01 | M |
| F4-04 | Ajuste por conteo: la API calcula `delta = contado − saldo` con `SELECT … FOR UPDATE` del saldo | `application/adjust-by-count.use-case.ts` | Integración: ajuste a 7 desde saldo 10 → `delta = -3`; ajuste igual al saldo rechazado (`delta ≠ 0`) | F4-03 | S |
| F4-05 | **Prueba de saldos concurrentes** (PostgreSQL real): doble ajuste, N salidas que juntas exceden el saldo, entradas y salidas cruzadas, misma `Idempotency-Key` en paralelo | `commerce/api/src/**/stock-concurrency.int.test.ts` | Saldo 10, 20 salidas de 1 en paralelo → exactamente 10 aceptadas, saldo final 0, 10 rechazadas; suma de `delta` de movimientos == saldo; misma clave 10 veces en paralelo → 1 movimiento. Repetida 20 veces | F4-03 | M |
| F4-06 | Poller de outbox de `commerce` reutilizando el patrón de F3-09 y eventos `received/issued/adjusted.v1` con payload de DATA-001 §6 | `commerce/api/src/infrastructure/outbox/*` | Integración: cada movimiento produce 1 evento del tipo correcto validado por el esquema Zod de `commerce-contracts` | F4-03, F3-09 | S |
| F4-07 | Controladores: productos (`commerce.catalog.manage`), lugares de stock, motivos (`commerce.reasons.manage`), movimientos y saldos (`commerce.stock.read/write`); guard de módulo | `commerce/api/src/presentation/*` | HTTP: `inventory` opera; `staff` 403; `admin` todo; catálogo de otra org 404; `Idempotency-Key` obligatoria en movimientos | F4-02, F4-03, F1-07 | M |
| F4-08 | Cliente web de inventario (hooks, tipos desde `commerce-contracts`) | `domains/commerce/web/src/api` | Vitest: errores de saldo insuficiente se tipifican para la UI | F4-07 | S |
| F4-09 | **`[DISEÑO]`** Inventario: catálogo de productos, saldos por lugar de stock, registro de entrada/salida/ajuste (con motivo y nota), historial de movimientos | `domains/commerce/web/src/{catalog,movements}` | Revisión de diseño aprobada; ajuste por conteo pide la cantidad contada; mensaje claro si el saldo es insuficiente | F4-08 | M |
| F4-10 | **`[DISEÑO]`** Administración de lugares de stock y motivos de movimiento | `commerce/web/src/settings` | Revisión de diseño aprobada | F4-08 | S |
| F4-11 | E2E: `inventario1` da de alta producto, registra entrada, salida y ajuste; saldo e historial coinciden; `staff` no ve inventario | `e2e/inventory.spec.ts` | `pnpm test:e2e` verde | F4-09 | S |

**Cierre de fase:** F4-05 y F4-11 verdes. **Total: 11 tareas.**

---

## 7. Fase 5 — Analytics (agregaciones, proyecciones y tablero básico)

Resultado (TECH-001 §12): **métricas concuerdan con registros fuente**. Analytics no lee tablas de otros esquemas.

> **Estado 27/10/2026 (rama `fase-5/metricas`, 19 commits sobre `fase-4/inventario`):** backend hecho: F5-01…F5-11.
> - Migración `analytics` y repositorios Prisma.
> - Suscriptor registrado en el host junto a los de los otros dominios.
> - Las 6 permutaciones de eventos convergen al mismo resultado, gracias a los reintentos del poller.
> - F5-09 hecha como prueba de integración con Vitest (analytics fallando no frena llamados ni tablero).
> - API `GET /api/v1/locations/:locationId/metrics/service-calls` (`analytics.calls.read`) y `…/metrics/inventory` (`analytics.inventory.read`), detrás del guard de módulo. Query: `range`, `from`/`to` (fechas locales, solo con `custom`), `group_by`, filtros `zone_id`/`table_id` o `product_id`/`stock_location_id`.
> - `analytics-web` con cliente, hooks y el ayudante `toMetricsQuery` para el selector de rango, **sin pantallas**.
> - Q-09 implementada: `EventHistoryReader` por emisor y `pnpm analytics:rebuild` atómico (TRUNCATE y reproceso en una transacción; un evento inválido revierte todo).
> - `pnpm seed` (core → hospitality → commerce → history) deja 14 días de historial de Bar Demo.
>
> Verificado con `docker compose`: 405 llamados en 14 días; `inventario1` recibe 403 en llamados. Pendientes: **F5-12 `[DISEÑO]`** y F5-13 (E2E, depende de F5-12). Los eventos desordenados se **rechazan y se reintentan** (DATA-001 §5), en vez del upsert tolerante que menciona F5-03. **Ajuste 27/10:** `by_period` trae todas las horas o días del rango en 0 hasta la cubeta actual (las futuras no aparecen), para graficar sin rellenar en el front. **Seed (27/10):** el historial cubre también Bar Demo Pisos, con su propio gateway y 6 botones, zonas incluidas: 181 llamados frente a 405 de Bar Demo. Todos los números inventados están en `DEMO_CALL_PROFILE` (hospitality) y `DEMO_STOCK_PROFILE` (`apps/api/src/seed/history.ts`); se reemplazan con las mediciones del piloto (F6-13).

| ID | Tarea | Archivos / paquetes | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| F5-01 | Modelo Prisma + migración `analytics` (DATA-001 §5): `processed_events`, `service_call_facts`, `stock_movement_facts` | `domains/analytics/api/.../prisma/` | Migración OK; `check:separability` confirma que `analytics-api` no depende de `hospitality-api`/`commerce-api` | P0-01, F1-02 | S |
| F5-02 | Repositorios de proyección + `ProcessedEventRepository` (deduplicación por `event_id`) | `analytics/api/src/infrastructure/prisma-*.repository.ts` | Integración: el mismo `event_id` procesado dos veces deja una sola fila y un solo efecto | F5-01 | S |
| F5-03 | Suscriptores en proceso de `hospitality.service_call.{created,acknowledged,completed}.v1`: upsert **tolerante al desorden** (un `acknowledged` que llega antes que `created` no se pierde) | `application/project-service-call-events.use-case.ts`, registro en `AnalyticsModule` | Integración: entregar los 3 eventos en las 6 permutaciones → mismo `service_call_facts` final; error transitorio → reintento del poller sin duplicar | F5-02, F3-09 | M |
| F5-04 | Suscriptores de `commerce.stock.*.v1` hacia `stock_movement_facts` | `application/project-stock-events.use-case.ts` | Integración: movimientos de F4 aparecen como hechos; saldo actual = último `balance_after` por `(lugar, producto)` | F5-02, F4-06 | S |
| F5-05 | Consultas de métricas de llamados: conteo, estados, tiempos de reconocimiento y cierre, repeticiones, agrupación por hora/día en la zona horaria del local (vía `CoreAccessPort`), filtros por zona y mesa, atajos de rango | `application/*-query.use-case.ts`, `infrastructure/*-query.ts` | Integración con datos conocidos: totales y promedios coinciden con un cálculo manual en el mismo test; el cambio de zona horaria mueve un llamado a otra franja; sin consultar tablas ajenas | F5-03, F1-08 | M |
| F5-06 | Consultas de métricas de inventario (movimientos por dirección/motivo, saldos) | idem | Integración: las sumas por motivo coinciden con los hechos sembrados | F5-04 | S |
| F5-07 | Controladores `GET /api/v1/metrics/service-calls` y `/metrics/inventory` con `analytics.calls.read` / `analytics.inventory.read` + guard de módulo | `analytics/api/src/presentation/*` | HTTP: `admin` ve ambos; `inventory` solo inventario; `staff` 403; local ajeno 404 | F5-05, F5-06, F1-07 | S |
| F5-08 | Reconstrucción de proyecciones: comando que vacía las tablas y reprocesa el historial de `outbox_events` de `hospitality` y `commerce` **a través del puerto de lectura** que exponga cada emisor (sin SQL cruzado) | `analytics/api`, puerto en `hospitality-contracts` y `commerce-contracts` (ver Q-09) | Integración: reconstruir sobre un historial conocido da exactamente las mismas tablas que la proyección en vivo | F5-03, F5-04 | M |
| F5-09 | Prueba de aislamiento operativo: con el suscriptor de analytics forzado a fallar, la pulsación, el reconocimiento y el tablero siguen funcionando | `e2e` o integración multi-módulo | Con analytics lanzando excepción, F3-16 pasa; los eventos quedan pendientes y se entregan al recuperarse | F5-03, F3-16 | S |
| F5-10 | Seed de demo completo (DATA-001 §7) por casos de uso: 15 mesas, zonas, gateway, 15 botones simulados asignados, ~10 productos con stock, motivos, **dos semanas de llamados y movimientos históricos** que generan eventos y proyecciones reales | `scripts/seed/*.ts` | `pnpm seed` idempotente; las métricas del «Bar Demo» muestran datos de 14 días; el seed no inserta SQL directo en otro dominio | F4-06, F5-03, F2-07 | M |
| F5-11 | Cliente web de métricas (hooks, selectores de rango y agrupación) | `domains/analytics/web/src/api` | Vitest: el rango «hoy/ayer/7/30/personalizado» produce el intervalo esperado en la zona del local | F5-07 | S |
| F5-12 | **`[DISEÑO]`** Tablero de métricas básicas (Recharts): llamados por mesa y franja, estados, tiempos, repeticiones, inventario | `domains/analytics/web/src/dashboard` | Revisión de diseño aprobada; rótulos que no sugieran más de lo medido («reconocimiento registrado», no «tiempo de atención real») | F5-11 | M |
| F5-13 | E2E de concordancia: crear llamados y movimientos nuevos desde simulador y UI, comparar el tablero de métricas con el historial fuente | `e2e/metrics-match.spec.ts` | Los totales mostrados coinciden con el conteo del historial y de movimientos | F5-12, F5-10 | S |

**Cierre de fase:** F5-05, F5-08, F5-09 y F5-13 verdes. **Total: 13 tareas.**

### Hito «demo mostrable» (TECH-001 §12, v1.2)

No es una fase nueva: se cumple cuando todas estas casillas se verifican a mano con `docker compose up` (sin hardware y con el simulador en un celular).

> **Estado 27/10/2026:** el backend de todas las casillas está listo y H9 (`docker compose up` + `pnpm seed`) está verificado. Lo que falta son las pantallas `[DISEÑO]`, de las que dependen H1–H8.

| # | Verificación | Tareas que la habilitan |
|---|---|---|
| H1 | Login por negocio (`/bar-demo`) y aislamiento con `/bar-demo-pisos` | F1-14, F1-12 |
| H2 | Mesas y zonas administrables | F2-13 |
| H3 | Consola de superadmin: gateways, botones, «detectados sin asignar», vinculación botón–mesa | F2-14, F3-15 |
| H4 | Tablero de barra en tiempo real con reconocer y finalizar; reconexión | F3-13, F3-12 |
| H5 | Historial de llamados | F3-14 |
| H6 | Inventario básico | F4-09 |
| H7 | Métricas básicas con datos de dos semanas | F5-12, F5-10 |
| H8 | Simulador en un celular enviando por HTTP y por MQTT | F2-10, F3-16 |
| H9 | `docker compose up` desde cero + `pnpm seed` deja todo listo | F5-10 |
| H10 | (ADR-003) Crear, guardar, publicar y usar al menos un plano 2D con llamados en tiempo real | L-05, L-06 |

---

## 8. Fase 6 — Instrumentación, fallos, seguridad, entrenamiento y piloto

Resultado (TECH-001 §12): evidencia de campo y criterios de aceptación. Varias tareas dependen de decisiones abiertas (hardware, VPS, umbrales), por eso quedan marcadas.

| ID | Tarea | Archivos / paquetes | Criterio de aceptación | Dep. | Tam. |
|---|---|---|---|---|---|
| F6-01 | Logs JSON con `correlation_id` propagado: gateway → adaptador → transacción → outbox → Socket.IO; sin datos sensibles (contraseñas, claves, token) | `apps/api` (interceptor/logger), cada `infrastructure/` | Prueba: una pulsación deja líneas con el mismo `correlation_id` en cada etapa; un test busca que ninguna línea contenga la clave del gateway ni la contraseña | F3-16 | M |
| F6-02 | Métricas de plataforma: eventos pendientes en outbox, reintentos, reconexiones, fallos de ingestión, estado de gateways (endpoint interno protegido; sin IDs de alta cardinalidad como etiquetas) | `apps/api`, `infrastructure/outbox` | Endpoint devuelve los contadores; un outbox con evento atascado se refleja en el contador | F3-09 | S |
| F6-03 | Instrumentación de tiempos según TECH-001 §8: `received_at`, `created_at`, `published_at`; ACK de cliente (`delivered_at`) **solo si Q-11 lo aprueba** | `hospitality/api`, `hospitality/web` | Los tiempos medibles se calculan desde campos persistidos; lo no instrumentado queda declarado como no medido | F3-10, Q-11 | M |
| F6-04 | Pruebas de fallos: caída de analytics, error transitorio de publicación, broker MQTT caído y recuperado, API reiniciada, presión simultánea en varias mesas (rampa de pulsaciones desde el simulador) | `e2e/failure/*`, scripts de carga con el propio `button-sim` | Sin pérdida de llamados aceptados por el API; sin llamados activos duplicados; documento con resultados | F5-09, F3-06 | M |
| F6-05 | Revisión de seguridad: cookies, `Origin`, límites de intentos, cabeceras (Caddy), enumeración de usuarios, claves de gateway, permisos por endpoint (matriz generada y comprobada), decisión sobre RLS (Q-12) | `docs`/`apps/api`, pruebas por endpoint | Una prueba recorre todos los controladores y falla si algún endpoint no declara permiso o guard (excepto los públicos listados) | F5-07 | M |
| F6-06 | Copias de seguridad y restauración de la base (`pg_dump` programado en el VPS) | `scripts/backup.sh`, `docker-compose.yml` | Restauración probada en una base vacía y comparación de conteos | Q-04 | S |
| F6-07 | Despliegue a VPS con `docker compose` + Caddy con HTTPS **solo para mostrar en el bar** | `docker-compose.prod.yml`, `.env` de producción fuera del repo | Demo accesible por HTTPS, `pnpm seed` ejecutado, sin puertos de base ni broker expuestos | Q-04, hito demo | M |
| F6-08 | Prueba técnica de hardware: adaptador real para el botón/gateway elegido (formato real → mensaje del contrato), calibración de `DEBOUNCE_MS`, alcance y batería en mesas reales | `hospitality/api/src/infrastructure/iot/<proveedor>.adapter.ts` | Cada pulsación de una lista de prueba se compara con los eventos recibidos; se separa falla de botón, RF/red, gateway, backend y navegador. **No inventar protocolo hasta tener el hardware (Q-01)** | Q-01, F3-05 | M |
| F6-09 | Procedimiento manual de respaldo y semántica ante caída de internet/gateway (qué ve el personal, qué se hace) | doc corta + textos de UI | Revisado con el bar; el tablero muestra la causa visible (Q-02) | F3-11, Q-02 | S |
| F6-10 | **`[DISEÑO]`** Textos y estados de error operativos en español («Mesa 5 necesita atención»), vacíos, sin conexión | `domains/*/web`, `apps/portal` | Revisión de diseño aprobada | F3-13 | S |
| F6-11 | Acordar con el bar los umbrales de aceptación (recepción, latencia de visualización, duplicados, disponibilidad, concordancia de inventario, usabilidad) y convertirlos en una lista de comprobación | doc nueva (no inventar cifras) | Umbrales firmados por el responsable y el bar antes de empezar el piloto | Q-03 | S |
| F6-12 | Capacitación breve del personal y guía de una página | documento de entrenamiento | Sesión realizada; el personal reconoce y finaliza un llamado sin ayuda | F6-10 | S |
| F6-13 | Piloto controlado y recolección de evidencia según BRAND-002 §11.8 (recepción, reconocimiento, cierre, repeticiones, uso, inventario vs. conteo físico, costos) | informe de piloto | Reporte con indicadores y fallos separados por origen; sin inferir ahorro de tiempo | F6-08, F6-11, F6-12 | M |
| F6-14 | Política de retención de auditoría, `device_events`, `outbox_events` y logs (hoy no se borra nada) | doc + tarea programada si procede | Decisión documentada (Q-06) y, si hay purga, probada sobre reconstrucción de proyecciones | Q-06 | S |

**Cierre de fase:** F6-11 y F6-13 cerradas. **Total: 14 tareas.**

---

## 8 bis. Ampliación ADR-003 — editor visual de espacios

Origen: `ADR-003` y sus decisiones del 28/10/2026 (§17). Amplía F2-13, F3-13 y F3-16; no cambia las demás tareas.

> **Estado 28/10/2026 (rama `adr-003/planos`, integrada en `main`):** backend hecho: L-01…L-04. Verificado: typecheck, pruebas unitarias, separabilidad, 48 archivos de integración y build. Pendientes: **L-05, L-06 `[DISEÑO]`** y L-07 (E2E).

| ID | Tarea | Criterio de aceptación | Dep. | Estado |
|---|---|---|---|---|
| L-01 | Migración `0003_space_layouts` (DATA-001 §3.1) | Un borrador y un publicado por espacio, `NULL` como un solo espacio, CHECK de estado y lienzo | — | hecha |
| L-02 | API de planos: publicados, borrador (GET/PUT), publicar; validación de elementos y mesas; 409 por `revision`; evento `layout.published` | Pruebas HTTP con base real: permisos, aislamiento, conflictos, publicaciones en paralelo, mesa movida de zona | L-01 | hecha |
| L-03 | Hooks web `useLayouts`, `useLayoutDraft`, `useSaveLayoutDraft`, `usePublishLayout` | Estados tipados `conflict` y `validation`; `layout.published` invalida los planos | L-02 | hecha |
| L-04 | Seed: planos publicados de Bar Demo (espacio único) y de cada zona de Bar Demo Pisos | Idempotente; prueba del seed | L-02 | hecha |
| L-05 | **`[DISEÑO]`** Editor visual de espacios: lienzo, herramientas, propiedades, «Mesas sin ubicar», guardar y publicar (amplía F2-13) | Revisión de diseño aprobada; ESP-01…ESP-22 | L-03 | pendiente |
| L-06 | **`[DISEÑO]`** Tablero operativo sobre el plano publicado, con cola global de llamados siempre visible (amplía F3-13) | Revisión de diseño aprobada; ESP-23…ESP-30, CU-01…CU-13 | L-03, F3-12 | pendiente |
| L-07 | E2E: botón → mesa resaltada en el plano → reconocer → finalizar; publicar mientras el staff mira; reconexión (amplía F3-16) | `pnpm test:e2e` en verde | L-05, L-06 | pendiente |

## 9. Resumen de tareas

| Bloque | Tareas | De ellas `[DISEÑO]` |
|---|---|---|
| P0 (bloqueante) | 1 | 0 |
| Fase 1 | 16 | 2 (F1-14, F1-15) |
| Fase 2 | 15 | 3 (F2-10, F2-13, F2-14) |
| Fase 3 | 16 | 3 (F3-13, F3-14, F3-15) |
| Fase 4 | 11 | 2 (F4-09, F4-10) |
| Fase 5 | 13 | 1 (F5-12) |
| Fase 6 | 14 | 1 (F6-10) |
| ADR-003 (§8 bis) | 7 | 2 (L-05, L-06) |
| **Total** | **93** | **14** |

## 10. Orden recomendado y camino crítico

```text
P0-01 ──► F1-01 ─► F1-02 ─► F1-03 ─► F1-04 ─► F1-05 ─► F1-06 ─► F1-07 ─► F1-09 ─► F1-11 ─► F1-12
                                                          │                   │
                                                          └─► F1-13 ─► F1-14 ─┴─► F1-16
 F1-02 ─► F2-01 ─► F2-03 ─► F2-07 ─► F2-14 ─► F2-15
              └─► F3-01 ─► F3-03 ─► F3-04 ─► F3-05 ─► F3-08 ─► F3-10 ─► F3-12 ─► F3-13 ─► F3-16
                                  └─► F3-09 ─► F5-03 ─► F5-05 ─► F5-12 ─► F5-13
 F4-01 … F4-06 ──► F5-04 ──► F5-10 (seed) ─► HITO DEMO
```

**Camino crítico hacia la demo (secuencia que no admite paralelo):**
`P0-01 → F1-01 → F1-02 → F2-01 → F3-01 → F3-03 → F3-05 → F3-08 → F3-10 → F3-12 → F3-13 (diseño) → F3-16 → F5-03 → F5-05 → F5-10 → hito demo`.

**Paralelizable** (ya sea por una persona alternando o con asistencia): 
- Mientras corre `P0-01`: preparar `F2-09` (simulador) y `F2-11` (Mosquitto), que no necesitan base de datos.
- Las revisiones de diseño `[DISEÑO]` deben pedirse **con una fase de antelación**: la del tablero (F3-13) es la más larga de resolver y está en el camino crítico; conviene tener el visto bueno cuando termine F3-10.
- Fase 4 (`commerce`) es independiente de F2/F3 salvo `F3-09` (patrón de outbox) y puede intercalarse mientras se espera una revisión de diseño. Fase 5 requiere F3-09 y F4-06.

**Orden sugerido de una persona:** P0 → F1 → F2 (sin UI) → F3 hasta F3-10 → pedir diseño del tablero → F4 → F3-12/13/16 → F5 → hito demo → F6.

## 11. Riesgos

| # | Riesgo | Mitigación en el plan |
|---|---|---|
| R1 | Prisma no expresa `uuidv7()`, índices parciales, `NULLS NOT DISTINCT`, `CHECK`, FK compuestas; el modelo Prisma y el SQL pueden divergir | Cada migración se edita a mano y lleva su prueba que viola la restricción (F1-01, F2-01, F4-01). Revisar el diff de `prisma migrate diff` en cada tarea |
| R2 | Una migración con tablas de migración por esquema (cuatro clientes Prisma en una base) puede dar fricción con la base sombra y con el cliente generado de cada dominio | Probar la mecánica con `core` en F1-01 antes de repetirla; anotar el procedimiento |
| R3 | El hardware real puede no ofrecer identificador único, secuencia ni hora fiable; la deduplicación de 3 s puede ser inadecuada | `DEBOUNCE_MS` configurable (F3-03), adaptador aislado (F3-05/06/07), calibración con hardware real (F6-08) |
| R4 | `press_count` solo llega a analytics en los eventos `acknowledged`/`completed`; las pulsaciones repetidas de un llamado que sigue pendiente no generan evento, por lo que la métrica de «repeticiones» subestima | Ver Q-07. No presentar la métrica como completa hasta decidir |
| R5 | Entrega *at-least-once* y reintentos pueden desordenar eventos | F5-03 exige upsert tolerante al desorden con prueba de permutaciones |
| R6 | El diseño de UI es el cuello de botella (el responsable lo identificó como su punto débil y quiere una UI no genérica) | 12 tareas `[DISEÑO]` marcadas; pedir las revisiones con antelación; tokens de BRAND-002 ya definidos en Fase 0 |
| R7 | Pruebas de concurrencia que pasan una vez pero fallan de forma intermitente | F3-04 y F4-05 se repiten 20 veces en el criterio |
| R8 | Un único proceso aloja API, Socket.IO, poller y MQTT; un fallo tumba todo | Aceptado para el piloto (opción A). Medirlo en F6-04; reevaluar A/B al separar repositorios |
| R9 | Dependencia de Docker/Mosquitto para las pruebas de integración y MQTT en máquinas sin Docker | F1-02 falla con mensaje claro; documentar el requisito |
| R10 | El responsable es el único desarrollador y revisor: la coordinación de revisiones de diseño y decisiones del §12 puede bloquear | Pedir decisiones por lotes y con la alternativa más barata de revertir ya redactada |

## 12. Preguntas abiertas (no se asumen decisiones)

Las de los documentos que siguen abiertos y las que este plan detectó. Cada una con la tarea que bloquea.

| ID | Pregunta | Origen | Bloquea |
|---|---|---|---|
| Q-01 | ¿Qué hardware se elige (botón, receptor, gateway), con qué protocolo, identificador único, hora y buffering? ¿Cuántos botones/mesas tendrá el piloto (la cifra «≈20» no está congelada)? | TECH-001 §2, §14.1, §11 | F6-08 |
| Q-02 | ¿Qué debe ocurrir y qué debe ver el personal cuando cae internet o el gateway? ¿Se promete recuperar pulsaciones perdidas (solo si el hardware tiene cola)? | TECH-001 §9, BRAND-002 §11.4(7) | F6-09 |
| Q-03 | ¿Cuáles son los umbrales numéricos de aceptación (recepción, latencia, duplicados, disponibilidad, concordancia de inventario, usabilidad) y quién los firma? Los ámbar 2 min / rojo 5 min y 3 s de rebote son constantes visuales/técnicas, no criterios | TECH-001 §11, BRAND-002 §11.8 | F6-11, F6-13 |
| Q-04 | ¿Qué proveedor de VPS/hosting y qué plan de copias? Solo necesario para mostrar la demo en el bar | TECH-001 §2, §14.11 | F6-06, F6-07 |
| Q-05 | **Resuelta 25/10/2026 e implementada (rama de Fase 4): opción (a)**: `core` tiene su outbox con `core.location.created.v1`; commerce y hospitality se suscriben. Los locales creados antes del evento no tienen backfill. Pregunta original: ¿Cómo se entera `hospitality`/`commerce` de que se creó un local o un negocio (para crear `location_settings`, lugar de stock «Principal» y motivos sembrados)? DATA-001 §4 dice «se crea con el local» pero ADR-002 prohíbe consultas/FK entre dominios y no existe un evento `core.location.created`. Opciones: (a) evento de `core` por outbox (requiere añadirlo a `core-contracts`), (b) creación perezosa en el primer uso, (c) el seed/consola de superadmin llama a cada dominio | DATA-001 §4, §7; ADR-002 D1 | F2-08, F4-02 |
| Q-06 | ¿Cuál es la política de retención de `device_events`, `outbox_events` (hoy no se borran para reconstruir proyecciones), logs y trazas, y qué privacidad aplica? | TECH-001 §14.7, DATA-001 §6 | F6-14 |
| Q-07 | **Resuelta 25/10/2026:** se acepta el conteo final y no hay evento `repeat_pressed`. La métrica de repeticiones de llamados aún pendientes no se presenta como completa (R4). Pregunta original: ¿Debe `press_count` de un llamado pendiente llegar a analytics en vivo? Hoy los eventos solo salen al crear, reconocer y finalizar; la repetición durante `pending` no emite evento. Opciones: nuevo evento `repeat_pressed.v1`, o aceptar el conteo final | DATA-001 §3, §6; BRAND-002 §11.5 | F5-03, F5-05 |
| Q-08 | ¿Qué hace el adaptador ante una tecla no mapeada: la trata como `attention` o la descarta como `unknown`? | TECH-001 §16.4 | F3-07 |
| Q-09 | **Resuelta 25/10/2026 (por implementar en F5-08):** cada emisor expone en su `contracts` un puerto de lectura del historial sobre su propio outbox, incluidos los eventos ya despachados. El comando `rebuild` de analytics lo usa, y así recupera también los eventos despachados antes de que analytics se suscribiera. Pregunta original: ¿Cómo reconstruye analytics el historial sin tocar tablas ajenas? DATA-001 §5 dice «reprocesar el historial de `outbox_events`», pero eso es leer una tabla ajena. Propuesta a validar: puerto de lectura de eventos en el `contracts` de cada emisor (en proceso hoy, HTTP mañana) | DATA-001 §5; ADR-002 D1 | F5-08 |
| Q-10 | ¿El simulador debe poder simular desconexión del gateway (dejar de enviar heartbeat) y mensajes duplicados/rebotes, para probar el tablero sin hardware? | TECH-001 §16.5–16.6 | F2-09, F3-11 |
| Q-11 | ¿Se implementa ACK del navegador (`delivered_at`/`visible_at`) en el piloto, o se declara no medido? | TECH-001 §3.2, §8 | F6-03 |
| Q-12 | ¿Se activa RLS en PostgreSQL como defensa adicional («si se justifica»)? Implica rol de conexión y `SET LOCAL` por transacción en cada repositorio | TECH-001 §9 | F6-05 |
| Q-13 | La contradicción de rutas: TECH-001 §10.1 menciona `packages/contracts` compartido, mientras §5/ADR-002 D1 fijan `domains/<d>/contracts`. ¿Se confirma que no habrá `packages/contracts` global? (este plan asume que no) | TECH-001 §10.1 vs §5 | F1-13 |
| Q-14 | ¿Cuántas sesiones simultáneas por cuenta compartida `barra` y cómo se revoca si la tablet se pierde? (30 días deslizantes, revocables por el admin) | TECH-001 §16.3 | F1-09 |
| Q-15 | **Resuelta 28/10/2026:** se bloquea (409 `table_in_use`) si la mesa tiene botones asignados o un llamado activo; nada se cierra ni desasigna solo. Pregunta original: ¿Qué pasa con una mesa desactivada que tiene un llamado activo o botones asignados? Los documentos no lo dicen (desactivar la mesa, cerrar el llamado, liberar botones) | DATA-001 §3 | F2-05 |
| Q-16 | **Resuelta 28/10/2026:** sin cancelación ni vencimiento automático en el MVP. El tablero los mantiene en rojo con su espera y el personal los finaliza a mano. Si el piloto muestra que se acumulan, se escribe un ADR para un estado `dismissed`. Pregunta original: ¿Puede un llamado `pending` quedarse indefinidamente? No hay cancelación (requeriría ADR) ni vencimiento; el tablero acumularía llamados olvidados | ADR-002 D4 | F3-13 |
| Q-17 | Estado de la marca: Modivara es un nombre candidato sin registro validado. ¿Se usa en textos de UI del piloto o un nombre neutro hasta validarlo? | TECH-001 §2, BRAND-002 §14 | F1-14, F6-10 |

**Preguntas nuevas añadidas por este plan:** Q-05, Q-07, Q-08, Q-09, Q-10, Q-13, Q-14, Q-15, Q-16 (9). El resto ya estaba abierto o parcialmente señalado en los documentos.

### Decisiones operativas que bloquean el piloto (28/10/2026)

No impiden diseñar ni construir las pantallas, pero sí aceptar el piloto (F6):

| Decisión | Pregunta | Quién decide | Bloquea |
|---|---|---|---|
| ~~Mesa desactivada con llamados activos o botones~~ | Q-15 **resuelta 28/10**: bloqueo con 409 | — | — |
| ~~Llamados `pending` sin cerrar indefinidamente~~ | Q-16 **resuelta 28/10**: sin vencimiento en el MVP; ADR si el piloto lo pide | — | — |
| Hardware real (botón, gateway, protocolo, cantidad) | Q-01 | Responsable, con prueba técnica | F6-08 |
| Criterios medibles de aceptación del piloto | Q-03 | Responsable y el bar | F6-11, F6-13 |

## 13. Control de cambios

- **v1.0 (19/10/2026):** propuesta inicial. Genera la sesión nocturna; revisar con el responsable al abrir `P0-01`.
- **v1.1 (27/10/2026):** notas de estado de las fases 1 a 3 (20–22/10) y de las fases 0, 4 y 5 (27/10), sacadas de `git log` de las ramas; Q-05, Q-07 y Q-09 resueltas; precedencia actualizada a TECH-001 v1.4. No cambia tareas ni criterios. Ese mismo día, más tarde: backend de la Fase 5 terminado (nota de estado de la fase y del hito demo).
- **v1.5 (28/10/2026):** Q-15 y Q-16 resueltas. Los documentos pasan a `modivara/docs/`, versionados en el repo.
- **v1.4 (28/10/2026):** ADR-003 encabeza la precedencia; F3-13 queda reemplazada por L-06 (plano y cola, sin cuadrícula); tabla de decisiones operativas que bloquean el piloto (§12).
- **v1.3 (28/10/2026):** ampliación ADR-003 (§8 bis, tareas L-01…L-07; las cuatro de backend ya están hechas), casilla H10 en el hito de la demo y totales del resumen. Las ramas `fase-*` se integraron en `main`.
- **v1.2 (27/10/2026):** soporte del backend para F1-15 y F3-14: hooks de usuarios, detalle de llamado con transiciones y nombres de actores. Métricas con periodos en 0 y tope de días en `custom`. Historial y perfil de demo también para Bar Demo Pisos.
