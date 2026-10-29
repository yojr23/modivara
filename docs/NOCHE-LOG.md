# NOCHE-LOG — Sesión nocturna 19→20/10/2026

Repo: `modivara/` · rama `fase-0/esqueleto` (41 commits sobre `main`) · sin push, sin remoto, sin migraciones.

## 1. Hecho

| Tarea | Estado | Dónde |
|---|---|---|
| T1 Repositorio | hecha | `git init` en `main` + rama `fase-0/esqueleto`; `.gitignore` (incluye `.env`, `AGENTS.md`, `CLAUDE.md`, `MEMORY.md`, `.claude/`), `.env.example` |
| T2 Workspace | hecha | pnpm workspaces, versiones exactas, TS 7 strict, Vitest 5; scripts `build`, `typecheck`, `test`, `check:separability` |
| T3 Estructura | hecha | `apps/{api,portal,button-sim}`, `domains/<d>/{api,web,contracts}`; `exports` solo `src/index.ts` (condición `source`) |
| T4 Separabilidad | hecha | `scripts/check-separability.mjs` + pruebas; falla ante dependencias `*-api/*-web` ajenas, imports internos o relativos fuera del dominio, y compila/prueba cada dominio aislado |
| T5 Piezas puras | **ampliada** | Dominio + casos de uso + puertos (Clean Architecture, TECH-001 v1.3) de los 4 dominios, con dobles en memoria; sin base de datos |
| T6 Portal base visual | hecha | Tokens BRAND-002 (claro/oscuro), Manrope + Inter autoalojadas, prueba de contraste WCAG, `Button`, `StatusBadge`, página `/_tokens` (revisada visualmente en Chrome) |
| T7 Docker | hecha | `docker-compose.yml` (db postgres:18.6, mqtt 2.1.2, api, web, button-sim, caddy 2.11.7), Dockerfile multietapa; `docker compose build` y `up` verificados: `/api/v1/health`, portal y `/sim` responden por Caddy |
| T8 Plan | hecha | `documentos/PLAN-001_plan_de_trabajo_mvp.md`: 86 tareas, bloqueante P0-01 (revisar DATA-001), hito demo, riesgos y 17 preguntas |
| Extra | hecha | Simulador `button-sim` funcional (página para celular, canales HTTP/MQTT intercambiables, señal de vida 30 s, protección CSRF) |
| Extra | hecha | Revisión de código de toda la rama + 6 correcciones (aislamiento por local en commerce, local/negocio inactivo, sin Zod en `domain/`, convenciones comunes) |

Por dominio (todo sin Prisma; el módulo Nest de cada dominio sigue sin bindings hasta que existan los repositorios reales):

- **core**: Organization, Location, AppUser (bloqueo 5/15 min), LocationMembership, Session (30 días deslizante, touch ≤ 1/h), Entitlement; casos de uso Login, Logout, AuthenticateSession, ChangePassword, ResetPassword, CreateUser, DeactivateUser, SetLocationRoles, RevokeUserSessions, ResolveLocationAccess, SelectActingOrganization; `CoreAccessService` (implementa `CoreAccessPort`); Argon2id y tokens SHA-256. Contracts: permisos/roles, reglas puras, esquemas Zod, sobre de eventos.
- **hospitality**: tabla `TRANSITIONS` + `ServiceCall`, debounce 3 s, `canSeeCall`, Zone, DiningTable, Device, DeviceAssignment, Gateway (90 s), DeviceEvent; RegisterButtonPress (todos los resultados de DATA-001 §3), Acknowledge/Complete, mesas/zonas, botones, gateways, heartbeat, listados; adaptador de pulsación. Contracts: eventos v1, mensajes del gateway, constantes del tablero.
- **commerce**: `Quantity` decimal exacta (bigint), Product, StockLocation, MovementReason, StockMovement, StockBalance (sin negativos); RegisterMovement, AdjustToCount, idempotencia, saldos y movimientos por local. Contracts: eventos v1, motivos sembrados, DTOs.
- **analytics**: facts de llamados y movimientos (idempotentes y tolerantes a desorden), métricas con zona horaria (`Intl`), atajos de rango, rebuild. Contracts: consultas y respuestas.

## 2. Decisiones que tomé sin consultar

| Decisión | Motivo | Cómo revertir |
|---|---|---|
| TECH-001 → **v1.3** (Clean Architecture + Repository por agregado) | Aprobado por ti antes de empezar (única modificación documental) | Revertir §5/§13/§15/§16.1 de TECH-001 |
| Node 24.22.0 vía nvm, usado por `PATH` | `~/.npmrc` tiene `prefix` y `nvm use` se niega; no toqué tu `.npmrc` | `nvm uninstall 24` |
| pnpm 10.18.3 (no 12) | pnpm 12 es binario nativo y corepack 0.32 no lo activa | Cambiar `packageManager` |
| Prisma 7.10.1 previsto (no 8) | `latest` de npm es 8.0.0-rc | — (aún no instalado) |
| TypeScript 7.0.2 | Verifiqué que emite metadata de decoradores para Nest | Bajar a 5.x si algo falla |
| Un solo Dockerfile con targets | Menos archivos; imágenes api/sim de 549 MB (`ponytail:` → `pnpm deploy --prod`) | Separar por app al dividir repos |
| Docker Desktop iniciado | Para verificar el build | — |
| Archivos de agentes | `AGENTS.md`, `CLAUDE.md`, `MEMORY.md`, `.claude/agents/{backend,frontend}.md` en `modivara/`, ignorados por git | Borrarlos o quitarlos del `.gitignore` |
| `infra/mosquitto/passwd` local | Creado para probar el stack (ignorado por git) | Borrarlo |

## 3. Decisiones abiertas (no asumidas; marcadas `// OPEN:` en el código)

Lista completa y viva en `modivara/MEMORY.md` → «Decisiones abiertas» (43 puntos). Las más importantes:

1. **DATA-001 §8** (bloqueante): longitud de slug/username, orden de mesas, catálogo por negocio o por local.
2. **Transacción de la pulsación** con Repository por agregado: DATA-001 §3 pide una sola transacción para `device_event` + `service_call`; propuesta: método atómico en un puerto de pulsaciones, sin UnitOfWork genérico.
3. Valor de `device_event_result` para local inactivo (hoy `unassigned_device`; proponer `location_inactive`).
4. Ids: uuid generado en la app vs `DEFAULT uuidv7()` de la base.
5. Nombres concretos de permisos `platform.*`.
6. Header de la clave del gateway (`x-gateway-key` provisional) y formato de códigos de botón.
7. Tecla → `call_type`: ¿el adaptador consulta el modelo del dispositivo?
8. Bloqueo de login revela que el usuario existe (`AccountLockedError`).
9. Colores derivados del portal, rojo de espera > 5 min, asignación color ↔ estado.
10. Proteger `/sim` con autenticación antes de publicar en un VPS.
11. Las 17 preguntas de PLAN-001 §12.

## 4. Contradicciones o errores en los documentos

- TECH-001 §10.1/§10.2 todavía menciona `packages/contracts` global; §5 y ADR-002 D1 fijan `domains/<d>/contracts` (seguí estos).
- BRAND-002 cita rutas `Emprendimiento/...` y `BRAND-001`, que no está en `documentos/` (ya señalado antes).
- DATA-001 §5 reconstruye analytics leyendo `outbox_events` de otros esquemas, en tensión con «nunca lee tablas de otros esquemas» (PLAN-001 Q-09).
- DATA-001 §3 no tiene resultado de `device_event` para local inactivo.

## 5. Comandos para comprobarlo

```bash
cd ~/Desktop/JUNIOR/trabajo/emprendimiento/modivara
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
git log --oneline main..fase-0/esqueleto
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build && pnpm check:separability   # 339 pruebas
pnpm --filter @modivara/portal dev        # abrir http://localhost:5173/_tokens
cp -n .env.example .env && docker compose up --build   # http://localhost/api/v1/health · /sim
```

Resultado final verificado: typecheck, build y separabilidad OK; **339 pruebas** (core 40 + 84, hospitality 7 + 71, commerce 8 + 32, analytics 7 + 42, portal 37, button-sim 6, scripts 5); `docker compose build` y `up` OK.

## 6. Qué necesito de ti para seguir

1. **Revisar DATA-001** (PLAN-001 P0-01) y responder sus 3 preguntas de §8 → desbloquea Prisma, migraciones y los repositorios reales.
2. Decidir el punto 2 de §3 (transacción de la pulsación).
3. Repasar la lista de decisiones abiertas de `MEMORY.md`.
4. Revisar `/_tokens` y los colores derivados antes de diseñar el tablero de barra.
5. Cuando quieras: crear el repo privado en GitHub y hacer push (no lo hice).

---

## Anexo 20/10/2026 — ajustes de la auditoría

Aplicados los hallazgos de la auditoría (C1–C4, A1–A4, D1–D7, SOLID, P1–P5, menores y §6 de documentos) con las decisiones del responsable:
- DATA-001 §8 cerrado: slug 3–40 / username 3–32, orden por `position`, **catálogo por local**.
- **Puerto transaccional acotado** (`withDeviceLock`, `withLockedBalance`, `withLoginLock`): pulsación y movimiento atómicos, sin actualizaciones perdidas.
- Eventos desordenados en analytics: **rechazar y reintentar**; facts completos.
- `location_inactive` y tabla `core.audit_log`.

Además: kernel compartido en `core-contracts` (errores, AggregateRoot, mapeo de eventos, `findActiveLocation`, `newId()` UUIDv7); decimales únicos en `commerce-contracts`; búsquedas por id con objeto acotado por tenant; superficies públicas mínimas; `schema.prisma` + `prisma.config.ts` por dominio (Prisma 7.10.1, sin modelos); portal compatible con shadcn/ui (Radix Slot, `components.json`, alias `@/`); un rol PostgreSQL por esquema y variables mínimas por servicio; convenciones de arquitectura versionadas en el README.

Documentos: TECH-001 **v1.4**, DATA-001 **v1.1**, BRAND-002 (referencias), PLAN-001 (P0-01 cerrada).

Verificado: typecheck, build, separabilidad, `prisma validate` ×4 y **374 pruebas**; `docker compose build/up` OK (la API recibe solo las 4 URLs de su dominio; el simulador no recibe credenciales de la base). Rama con 69 commits sobre `main`.

Nota de historial: dos commits intermedios de core (`55444cc`, `bf3c550`) no compilan aislados (archivos nuevos quedaron en `950e848`); no se reescribió el historial.

Pendientes abiertos: dead-letter de analytics, ventana `since` de botones desconocidos, almacenamiento del límite por IP, unificar `duplicate`/`conflict` (ver `modivara/MEMORY.md`).

---

## Fase 1 — identidad (20/10/2026), rama `fase-1/identidad` (28 commits sobre `fase-0/esqueleto`)

Hecho (PLAN-001 F1-01…F1-13): migración `core` con SQL explícito y pruebas de restricciones; infraestructura `pnpm test:integration` (db-test) y `pnpm migration:new`; adaptadores Prisma de todos los puertos de core; `CoreModule.forRoot` con `CoreAccessPort` en proceso; auth HTTP (cookie HttpOnly/Secure/SameSite=Strict, guard de Origin, límite por IP, filtro de errores por `code`); guards globales de sesión/permiso/módulo; administración de usuarios; superadmin operando sobre un negocio; auditoría atómica; seed idempotente; prueba de aislamiento; portal con sesión, rutas protegidas y navegación por módulos (sin diseño); migraciones al arrancar el contenedor.

Revisiones de seguridad y correcciones: protección de cuentas de dueños; login bloqueado responde igual que credenciales inválidas; gestión de usuarios acotada a los locales del admin; carrera touch/revocación de sesiones; ChangePassword atómico; seed que no corre en producción ni recrea desactivados; caché del portal vaciado en cada cambio de sesión.

Verificado: typecheck, build, separabilidad, **430 pruebas unitarias y 90 de integración**; Docker: seed, login de los 4 usuarios de `bar-demo`, `staff` sin acceso a `/users` (403).

Pendiente: F1-14 y F1-15 `[DISEÑO]` (pantalla de login y shell del portal: necesitan tu revisión de diseño) y F1-16 (E2E con Playwright). Decisiones abiertas nuevas en `modivara/MEMORY.md`.

---

## Fase 2 — mesas (21/10/2026), rama `fase-2/mesas` (18 commits sobre `fase-1/identidad`)

Hecho (backend): migración `hospitality` completa con restricciones en la base; adaptadores Prisma (zonas, mesas, dispositivos con historial de asignaciones, gateways con clave como SHA-256, `ButtonPressStore` con advisory lock, llamados con outbox); `HospitalityModule.forRoot`; API de zonas, mesas, estado de botones (sin datos técnicos) y plataforma (gateways, botones, desconocidos, asignar); `location_settings` por defecto; `press_count` vigente en eventos; seed de hospitality; prueba de punta a punta con core real; simulador probado por HTTP real y MQTT; script de usuarios MQTT y chequeo de ACL contra broker real; cliente web de configuración.

Revisión de seguridad: sin fallos de autorización ni secretos; corregidos ids de ruta sin validar (500 → 400) y contraseña MQTT visible en `ps`.

Verificado: **457 pruebas unitarias y 136 de integración**; Docker: seeds de core y hospitality, 15 mesas con botón, 400/403 donde corresponde.

Pendiente: F2-10/F2-13/F2-14 `[DISEÑO]`, E2E de navegador, y decidir la auditoría de acciones de plataforma en hospitality (ADR-002 D3).

---

## Fase 3 — tiempo real (22/10/2026), rama `fase-3/tiempo-real` (26 commits sobre `fase-2/mesas`)

Hecho (backend): ingesta del gateway por HTTP (clave en header, tenant solo de la clave, 401/400/429) y por MQTT (usuario por gateway, ACL, reconexión, sin mensajes retenidos); traducción tecla → tipo; suite de concurrencia (N=20, 20 corridas); API de llamados (activos, historial con cursor, reconocer/finalizar con 409 y estado vigente, idempotencia natural); poller de outbox (`SKIP LOCKED`, reintentos con espera creciente, una transacción por evento, tiempo máximo por suscriptor); Socket.IO con la cookie de sesión, Origin, salas por local y avisos filtrados; salud de gateways con aviso por transición; cliente de tiempo real del portal (reconexión con relectura REST).

Revisiones de seguridad: módulo deshabilitado respetado en la ingesta; límites de tamaño y tasa por gateway (antes del tope global); máximos en el mensaje; heartbeat que no reactiva gateways; cursor validado; suscripción que revalida la sesión.

Verificado: **494 pruebas unitarias y 184 de integración**; Docker: simulador HTTP y MQTT → llamado → en atención → atendido → historial; conectividad `all_connected`. La demo destapó un bug del `.env.example` (comentarios en línea con valor vacío), ya corregido.

Pendiente: F3-13/14/15 `[DISEÑO]` (tablero de barra, historial, consola de superadmin) y F3-16 E2E; auditoría de acciones de plataforma en hospitality (decisión pendiente).

---

## Fase 4 — inventario (25/10/2026), rama `fase-4/inventario` (14 commits sobre `fase-3/tiempo-real`)

Hecho (backend, PLAN-001 F4-01…F4-08): migración `commerce` con restricciones en la base; repositorios de productos, lugares de stock y motivos; libro de stock con saldo bloqueado (`withLockedBalance`) y ajuste por conteo; suite de saldos concurrentes (20 corridas); outbox de commerce con eventos `received/issued/adjusted.v1` validados; API HTTP de inventario (`Idempotency-Key` en header); cliente web con errores de saldo tipificados; `seed:commerce` idempotente.

Transversal: un solo poller de outbox en `core-contracts` con tope de 10 intentos (`failed_at`) y `pnpm outbox:retry`; outbox de core con `core.location.created.v1`, suscrito por commerce (motivos, «Principal») y hospitality (`location_settings`): cierra Q-05.

Verificado el 27/10 en `fase-5/metricas` (misma base): typecheck, 518 pruebas unitarias y separabilidad. Integración no corrida ese día (Docker apagado).

Pendiente: F4-09/F4-10 `[DISEÑO]` y F4-11 (E2E). Fase 5: rama `fase-5/metricas` creada sin commits; siguiente F5-01 (migración de analytics).

---

## Fase 5 — métricas (27/10/2026), rama `fase-5/metricas` (19 commits sobre `fase-4/inventario`)

Hecho (backend, PLAN-001 F5-01…F5-11): migración `analytics` y repositorios Prisma; `AnalyticsModule.forRoot` con suscriptor registrado en el host; proyección tolerante al desorden por reintentos (6 permutaciones), llamados y movimientos de punta a punta; aislamiento operativo con analytics fallando (F5-09, Vitest); consultas de métricas contra PostgreSQL (zona horaria del local); API `GET /api/v1/locations/:locationId/metrics/{service-calls,inventory}` con permisos y guard de módulo; cliente y hooks en `analytics-web` (sin pantallas); puerto de historial por emisor y `pnpm analytics:rebuild` atómico (Q-09); seed histórico de 14 días de Bar Demo y `pnpm seed`.

Verificado: typecheck, pruebas unitarias e integración, separabilidad y build; demo con `docker compose`: 405 llamados en 14 días, 244 movimientos de inventario, 403 de `inventario1` en métricas de llamados.

Pendiente: F5-12 `[DISEÑO]` (tablero de métricas) y F5-13 (E2E). Con esto el backend del hito «demo mostrable» está completo; faltan las pantallas de todas las fases. Decisiones abiertas nuevas en `modivara/MEMORY.md` (rutas de métricas, datos inventados del seed, desempate por `occurred_at`, abortar el rebuild ante un evento inválido).

### Fase 5 — ajustes para el diseño de pantallas (27/10/2026, misma rama)

- Detalle de llamado `GET /api/v1/locations/:locationId/service-calls/:callId`, con transiciones y nombres de actores (`acknowledged_by_name`, `completed_by_name`, `actor_name`) resueltos por core (`CoreAccessPort.userDisplayNames`); hooks `useCallDetail` y `useCallHistory`; hooks de usuarios en `core-web`.
- Métricas: `by_period` trae en 0 los periodos sin datos hasta la cubeta actual; `custom` acotado a 366 días (31 por hora), corrigiendo un hallazgo de seguridad (cubetas sin límite).
- Seed: perfil de demo único (`DEMO_CALL_PROFILE`, `DEMO_STOCK_PROFILE`); Bar Demo Pisos con gateway, 6 botones y 14 días de historial (181 llamados, 241 movimientos).
- Documentos: TECH-001 v1.5 (rutas reales, catálogo por local), DATA-001 v1.2 (outbox de core, `failed_at`, reconstrucción por puerto de historial), PLAN-001 v1.2.
- Verificado: typecheck, pruebas unitarias e integración (47 archivos), separabilidad y build en `6519cc1`.

---

## ADR-003 — planos de espacios (28/10/2026), rama `adr-003/planos` integrada en `main`

- Integración: las ramas `fase-0…fase-5` eran una pila lineal. `main` se adelantó hasta la punta sin merge y se borraron las ramas `fase-*`; queda `fase-3/tiempo-real` porque está checked out en el checkout principal.
- Decisiones del responsable en ADR-003 §17.
- Hecho (L-01…L-04): migración `0003_space_layouts`, API de borrador y publicación (409 por `revision`, publicaciones en paralelo con un solo ganador), evento `layout.published`, hooks web y planos de demo (Bar Demo y las zonas de Pisos).
- Verificado: typecheck, pruebas unitarias, separabilidad, 48 archivos de integración y build.
- Pendiente: editor (L-05) y tablero sobre el plano (L-06), ambos `[DISEÑO]`, y el E2E (L-07).
- Documentos: DATA-001 v1.3, TECH-001 v1.6 y PLAN-001 v1.3 (§8 bis, H10).
