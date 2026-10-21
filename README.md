# Modivara

Monorepo del MVP (pnpm workspaces). Destino: cuatro repositorios (`platform-core`, `hospitality-ops`, `commerce`, `analytics`); ver ADR-002 D1.

Documentación de arquitectura en `../documentos/` (ADR-001, ADR-002, TECH-001 v1.3, DATA-001, BRAND-002).

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
# Usuarios del broker MQTT (el archivo passwd no se versiona):
docker compose run --rm mqtt mosquitto_passwd -c -b /mosquitto/config/passwd api <clave-api>
docker compose up --build
```

El contenedor `api` aplica `prisma migrate deploy` de cada dominio al arrancar. Datos de demo de core (idempotente). La contraseña común se pasa solo a ese comando, nunca al entorno permanente del servidor:

```bash
docker compose exec -e SEED_PASSWORD='<clave de demo>' api sh -c 'cd /repo/apps/api && node dist/seed-core.js'
# con una base propia (CORE_DATABASE_URL en el entorno): SEED_PASSWORD=... pnpm seed:core
```

Usuarios: `labs/superadmin`, `bar-demo/{admin,barra,mesero1,inventario1}`, `bar-demo-pisos/admin`.

Portal en `http://localhost`, API en `http://localhost/api/v1/health`, simulador en `http://<ip-del-pc>/sim` desde el celular (misma Wi‑Fi).

## Estructura

```text
apps/api          host NestJS: solo compone los módulos de dominio
apps/portal       SPA React
apps/button-sim   simulador de gateway (proceso aparte, HTTP/MQTT)
domains/<d>/{api,web,contracts}   d ∈ core, hospitality, commerce, analytics
```

Dentro de cada `domains/<d>/api/src`: `domain/`, `application/` (casos de uso + `ports/`), `infrastructure/`, `presentation/` (TECH-001 §5 v1.3).

## Convenciones de arquitectura (TECH-001 §5 v1.4)

- **Capas por dominio:** `presentation`/`infrastructure` → `application` → `domain`. `domain/` no importa Nest, Prisma ni esquemas Zod (puede usar constantes y tipos de contracts).
- **Separabilidad:** un dominio solo depende de `*-contracts` de otros; nunca de rutas internas. `pnpm check:separability` lo verifica.
- **Kernel compartido** (`core-contracts`): `DomainError` y errores comunes con `code` estable; `AggregateRoot` + `pullEvents()`; `toEventEnvelope`; `findActiveLocation`; `newId()` (UUIDv7, generado en la app).
- **Tenant:** contexto del actor `{ organizationId, locationId?, actorUserId }`, siempre del servidor. Búsquedas por id con parámetro objeto y acotadas por negocio/local; si no coincide → `NotFoundError` (sin revelar existencia).
- **Transacciones:** Repository por agregado; si una operación abarca varios agregados o necesita bloqueo, **puerto transaccional acotado** (`withDeviceLock`, `withLockedBalance`), nunca UnitOfWork genérico.
- **Eventos:** internos en camelCase (`eventType`, `eventVersion`); un único mapeo al sobre snake_case; outbox en la misma transacción.
- **Tiempo:** sin puerto `Clock`; `new Date()` y temporizadores falsos de Vitest en pruebas.
- **Base de datos:** un esquema y un rol PostgreSQL por dominio; sin FK entre esquemas; FK compuestas `(x_id, location_id)` dentro del esquema.
