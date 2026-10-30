# Modivara

Monorepo del MVP (pnpm workspaces). Destino: cuatro repositorios (`platform-core`, `hospitality-ops`, `commerce`, `analytics`); ver ADR-002 D1.

Documentación de arquitectura en `docs/` (ADR-001, ADR-002, ADR-003, TECH-001, DATA-001, BRAND-002, más HANDOFF y NOCHE-LOG), plan de trabajo con el estado por fase en `PLAN-001`, diseño y decisiones de las pantallas en `PLAN-002` y el mapa del frontend (rutas, permisos, datos) en `docs/PORTAL.md`.

## Estado (30/10/2026)

Backend de las fases 1–5 y de ADR-003 completo. En el portal ya funcionan contra la API, con el diseño aprobado: **tablero** en tiempo real sobre los planos (`/<negocio>/app/tablero`), **editor de espacios** con áreas (`/espacios`), **métricas** sobre el plano (`/metricas`) e **inventario** (`/inventario`), más el login por negocio (`/<negocio>`). Faltan las pantallas de usuarios, historial de llamados, consola de superadmin, lugares y motivos, y los E2E con Playwright (detalle en PLAN-001 y `docs/PORTAL.md`).

## Desarrollo

Requisitos: Node 24 y pnpm 10 (`corepack enable`). Docker para la demo completa.

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm build
pnpm check:separability   # cada dominio compila y pasa sus pruebas aislado (ADR-002 D1)
pnpm --filter @modivara/portal dev
```

## Demo local con Docker

```bash
cp .env.example .env        # ajustar contraseñas locales
docker compose up --build
```

### Usuarios del broker MQTT

Sin anónimos. El hash de cada usuario queda en `infra/mosquitto/passwd` (ignorado por git); la contraseña aleatoria se imprime **una sola vez**. El mismo script crea y rota, y recarga el broker si está corriendo:

```bash
scripts/mqtt-user.sh api     # la API: lee modivara/gw/# → ponerla en MQTT_PASSWORD de la API
scripts/mqtt-user.sh gw-01   # un usuario por gateway; el usuario es el id del gateway y solo publica en modivara/gw/gw-01/#
```

La API se suscribe a `modivara/gw/+/press` y `…/heartbeat` con `MQTT_URL`, `MQTT_USERNAME` (`api`) y `MQTT_PASSWORD`; si falta alguna, no arranca el adaptador MQTT y lo registra una vez (HTTP sigue funcionando). Reconecta sola si el broker cae.
Límites de ingesta (HTTP y MQTT): mensajes de hasta 4 KB (el broker lo impone en `mosquitto.conf`; la API vuelve a descartar lo mayor), un limitador por gateway compartido por ambos canales (HTTP responde 429; MQTT descarta y lo registra una vez por minuto), tope de mensajes MQTT en vuelo por gateway y global, y descarte de mensajes retenidos. Los valores son provisionales (`// OPEN:` en `gateway-rate-limiter.ts` y `mqtt.adapter.ts`).

Para el simulador por MQTT: `SIM_GATEWAY_ID=gw-01` y `SIM_MQTT_PASSWORD=<la impresa>` en `.env`, `SIM_TRANSPORT=mqtt`.
`scripts/mqtt-acl-check.sh` verifica la ACL con un broker desechable (A publica en lo suyo y no en B; `api` lee ambos; clave errónea y anónimo rechazados).

El contenedor `api` aplica `prisma migrate deploy` de cada dominio al arrancar. Datos de demo de core (idempotente). La contraseña común se pasa solo a ese comando, nunca al entorno permanente del servidor:

```bash
# la imagen corre con NODE_ENV=production y el seed se niega allí: en la demo local se habilita explícitamente
docker compose exec -e NODE_ENV=development -e SEED_PASSWORD='<clave de demo>' api sh -c 'cd /repo/apps/api && node dist/seed-core.js'
# con una base propia (CORE_DATABASE_URL en el entorno): SEED_PASSWORD=... pnpm seed:core
```

Usuarios: `labs/superadmin`, `bar-demo/{admin,barra,mesero1,inventario1}`, `bar-demo-pisos/admin`.

Datos de demo de hospitality (después de `seed:core`; idempotente, se niega con `NODE_ENV=production`): `bar-demo` con 15 mesas sin zonas, un gateway y los botones `btn-01…btn-15` asignados; `bar-demo-pisos` con las zonas «Terraza» y «2º piso», números de mesa repetidos por zona, su propio gateway y los botones `p-btn-01…p-btn-06`. Cada espacio queda con un plano publicado (ADR-003): `bar-demo` con sus 15 mesas en cuadrícula más una barra y una puerta, y Pisos con un plano por zona. La clave del gateway se imprime **una sola vez**, solo cuando se crea (`SIM_GATEWAY_KEY=…`): cópiala al `.env` para el simulador.

```bash
docker compose exec -e NODE_ENV=development -e SEED_PASSWORD='<la misma clave de demo>' api sh -c 'cd /repo/apps/api && node dist/seed-hospitality.js'
# con una base propia (CORE_DATABASE_URL y HOSPITALITY_DATABASE_URL en el entorno): SEED_PASSWORD=... pnpm seed:hospitality
```

Datos de demo de commerce (después de `seed:core`; idempotente, se niega con `NODE_ENV=production`): en `bar-demo` y `bar-demo-pisos`, motivos sembrados, lugar «Principal» y 10 productos con stock inicial.

```bash
docker compose exec -e NODE_ENV=development -e SEED_PASSWORD='<la misma clave de demo>' api sh -c 'cd /repo/apps/api && node dist/seed-commerce.js'
# con una base propia (CORE_DATABASE_URL y COMMERCE_DATABASE_URL en el entorno): SEED_PASSWORD=... pnpm seed:commerce
```

Historial de demo (F5-10; después de los tres seeds anteriores; idempotente, se niega con `NODE_ENV=production`): en `bar-demo` y `bar-demo-pisos`, 14 días que terminan ayer (hora del local) con unos 30 (Pisos: unos 12) llamados por día en horas de noche (hospitality: llamados, transiciones, señales y outbox) y movimientos de stock diarios (commerce: ventas, mermas, cortesías, compras y un ajuste). Los números inventados están en `DEMO_CALL_PROFILE` y `DEMO_STOCK_PROFILE`. Cada dominio escribe solo lo suyo con fechas pasadas; analytics lo recibe cuando la API entrega los outbox pendientes (o con `pnpm analytics:rebuild`). Si commerce se sembró antes de F5-10 (stock inicial con fecha reciente) el comando lo detecta y pide recrear la base.

Todo de una vez (core → hospitality → commerce → historial; repetirlo no cambia nada). Con los seeds corriendo sin poller, **arranca la API después (o déjala corriendo: sus pollers entregan lo pendiente)**:

```bash
docker compose exec -e NODE_ENV=development -e SEED_PASSWORD='<clave de demo>' api sh -c 'cd /repo/apps/api && for s in core hospitality commerce history; do node dist/seed-$s.js || exit 1; done'
# con una base propia (las cuatro *_DATABASE_URL en el entorno): SEED_PASSWORD=... pnpm seed
```

Tiempo real y outbox de hospitality: Socket.IO en `/api/v1/realtime` (misma cookie de sesión; rechaza sin sesión y con `Origin` distinto del host) emite `service_call.changed` y `gateways.status` a la sala del local tras suscribirse con `location.subscribe`. El poller del outbox corre en el mismo proceso de la API cada `OUTBOX_POLL_INTERVAL_MS` (por defecto 1000) y entrega a los suscriptores registrados bajo `INTEGRATION_EVENT_SUBSCRIBERS` (una transacción por evento; 5 s máximo por entrega, vencido cuenta como fallo con espera creciente). Core, hospitality y commerce tienen cada uno su outbox y el mismo poller (`core-contracts`); core publica `core.location.created.v1` y los otros dos siembran lo suyo al recibirlo. Tras 10 intentos fallidos el evento queda con `failed_at` (y su `last_error`) y el poller deja de tomarlo; nada se borra. Para liberarlo: `pnpm outbox:retry <core|hospitality|commerce> [event_id]` (sin `event_id`, todos los detenidos de ese outbox; pone `failed_at = NULL, attempts = 0` y vence de inmediato).

Reconstruir analytics: `pnpm analytics:rebuild` vacía las tablas de analytics y reproduce en UNA transacción el historial completo (también lo ya despachado o con `failed_at`) que hospitality y commerce exponen por su puerto `EventHistoryReader` (lee su propio `outbox_events` ordenado por `occurred_at, id`, paginado), mezclado en ese mismo orden. Los eventos en vivo esperan al commit y luego se deduplican. Recupera lo despachado antes de que analytics se suscribiera. Un evento inválido aborta, revierte y se informa su `event_id`; imprime cuántos eventos leyó, aplicó, duplicó e ignoró. Corre sin pollers.

Portal en `http://localhost/<negocio>` (p. ej. `http://localhost/bar-demo`, usuario `admin` y la clave de `SEED_PASSWORD`), API en `http://localhost/api/v1/health`, simulador en `http://<ip-del-pc>/sim` desde el celular (misma Wi‑Fi). En desarrollo (`pnpm --filter @modivara/portal dev`) el portal no tiene proxy a la API: para probar con datos, usar el stack de Docker.

El plano de demo de Bar Demo trae las áreas «Barra», «Salón» y «Ventanal» (elemento `area`, ver `docs/PORTAL.md`). El seed no reescribe un plano ya publicado: en una base sembrada antes del 30/10 las áreas no aparecen hasta dibujarlas en el editor o recrear la base (`docker compose down -v`).

## Estructura

```text
apps/api          host NestJS: solo compone los módulos de dominio
apps/portal       SPA React: routes/ (login, sesión, shell por permisos) y app/ (tablero, espacios, métricas, inventario)
apps/button-sim   simulador de gateway (proceso aparte, HTTP/MQTT)
domains/<d>/{api,web,contracts}   d ∈ core, hospitality, commerce, analytics
```

Dentro de cada `domains/<d>/api/src`: `domain/`, `application/` (casos de uso + `ports/`), `infrastructure/`, `presentation/` (TECH-001 §5 v1.3). Los `domains/<d>/web` exponen el cliente y los hooks (TanStack Query) que usan las pantallas del portal.

## Convenciones de arquitectura (TECH-001 §5 v1.4)

- **Capas por dominio:** `presentation`/`infrastructure` → `application` → `domain`. `domain/` no importa Nest, Prisma ni esquemas Zod (puede usar constantes y tipos de contracts).
- **Separabilidad:** un dominio solo depende de `*-contracts` de otros; nunca de rutas internas. `pnpm check:separability` lo verifica.
- **Kernel compartido** (`core-contracts`): `DomainError` y errores comunes con `code` estable; `AggregateRoot` + `pullEvents()`; `toEventEnvelope`; `findActiveLocation`; `newId()` (UUIDv7, generado en la app).
- **Tenant:** contexto del actor `{ organizationId, locationId?, actorUserId }`, siempre del servidor. Búsquedas por id con parámetro objeto y acotadas por negocio/local; si no coincide → `NotFoundError` (sin revelar existencia).
- **Transacciones:** Repository por agregado; si una operación abarca varios agregados o necesita bloqueo, **puerto transaccional acotado** (`withDeviceLock`, `withLockedBalance`), nunca UnitOfWork genérico.
- **Eventos:** internos en camelCase (`eventType`, `eventVersion`); un único mapeo al sobre snake_case; outbox en la misma transacción.
- **Tiempo:** sin puerto `Clock`; `new Date()` y temporizadores falsos de Vitest en pruebas.
- **Base de datos:** un esquema y un rol PostgreSQL por dominio; sin FK entre esquemas; FK compuestas `(x_id, location_id)` dentro del esquema.
