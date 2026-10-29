# DATA-001 — Modelo de datos del MVP

> **Proyecto:** Emprendimiento — plataforma SaaS modular (Modivara, nombre candidato)  
> **Fecha:** 19 de octubre de 2026  
> **Versión:** 1.3 (28/10/2026) — planos de espacios en `hospitality` (§3.1, ADR-003). Antes: 1.2 (27/10/2026) — sincronizado con lo implementado: outbox también en `core`, tope de reintentos y reconstrucción de analytics (§5, §6). Antes: 1.1 (20/10/2026), §8 resuelto y ajustes de auditoría.  
> **Estado:** propuesta para revisión **antes de la primera migración**. El SQL es ilustrativo: las migraciones reales se generan con Prisma por dominio y se completan con SQL explícito para índices parciales, `CHECK` y restricciones que Prisma no expresa.  
> **Precedencia:** `ADR-001` y `ADR-002` gobiernan alcance y límites; `TECH-001` v1.2 §16 resume las decisiones de implementación que este modelo materializa.

## 1. Convenciones comunes

| Tema | Regla |
|---|---|
| Esquemas | `core`, `hospitality`, `commerce`, `analytics`. Cada uno con su propio cliente Prisma (`?schema=<dominio>`) y su propia tabla de migraciones. |
| Identificadores | `uuid` v7, ordenados por tiempo. **Se generan en la aplicación** (`newId()` de `core-contracts`) porque el id se necesita antes de insertar (transiciones, `aggregate_id` de eventos); `DEFAULT uuidv7()` (PostgreSQL 18) queda como respaldo. |
| Roles | Un rol PostgreSQL por esquema (`core_app`, `hospitality_app`, `commerce_app`, `analytics_app`), dueño solo de su esquema (`infra/postgres/init-schemas.sh`). |
| Tiempo | Siempre `timestamptz`. Zona horaria operativa en `core.locations.timezone`. |
| Borrado | No se borra historial. Las entidades configurables usan `deactivated_at timestamptz NULL`; las restricciones únicas aplican solo a filas activas. |
| Auditoría (configuración) | `created_at`, `updated_at`, `created_by`, `updated_by` en tablas que edita una persona. |
| Auditoría (negocio) | Historial completo con actor por fila: `service_call_transitions`, `device_assignments`, `stock_movements`. |
| Tablas de sistema | `sessions`, `outbox_events`, `device_events`, `processed_events`: sin actor humano; el origen va en sus propias columnas. |
| Actor | Siempre `core.app_users.id` (incluido el superadmin, ADR-002 D3). Las columnas de actor no llevan FK. |
| Referencias entre esquemas | **Sin FK entre esquemas.** Un `location_id` en `hospitality` es un `uuid` sin FK hacia `core.locations`; el servicio lo valida mediante `CoreAccessPort` al crear. |
| Tenant | `organization_id` y `location_id` se copian en las filas operativas desde el contexto autorizado en el servidor; nunca desde el cliente. |
| Consistencia de local dentro de un esquema | FK compuestas `(x_id, location_id)` para impedir mezclar filas de locales distintos. |

Columnas de auditoría abreviadas en el SQL como:

```sql
-- AUDIT
created_at  timestamptz NOT NULL DEFAULT now(),
updated_at  timestamptz NOT NULL DEFAULT now(),
created_by  uuid,
updated_by  uuid
```

## 2. Esquema `core` (propietario: `platform-core`)

```sql
CREATE TYPE core.location_role AS ENUM ('admin', 'staff', 'inventory');
CREATE TYPE core.module        AS ENUM ('hospitality', 'commerce', 'analytics');

CREATE TABLE core.organizations (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  slug           text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 40),
  name           text NOT NULL,
  is_platform    boolean NOT NULL DEFAULT false,
  -- AUDIT
  deactivated_at timestamptz
);
-- El slug nunca se reutiliza, aunque el negocio se desactive: un enlace viejo no debe llevar a otro negocio.
CREATE UNIQUE INDEX uq_organizations_slug ON core.organizations (slug);
-- Una sola organización de plataforma (ADR-002 D3).
CREATE UNIQUE INDEX uq_organizations_single_platform ON core.organizations (is_platform) WHERE is_platform;

CREATE TABLE core.locations (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES core.organizations (id),
  name            text NOT NULL,
  timezone        text NOT NULL DEFAULT 'America/Bogota',  -- validado en la API contra Intl.supportedValuesOf('timeZone')
  -- AUDIT
  deactivated_at  timestamptz,
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX uq_locations_name ON core.locations (organization_id, lower(name)) WHERE deactivated_at IS NULL;

CREATE TABLE core.app_users (
  id                        uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id           uuid NOT NULL REFERENCES core.organizations (id),
  username                  text NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,32}$'),  -- se guarda en minúsculas
  display_name              text NOT NULL,
  password_hash             text NOT NULL,                  -- Argon2id
  is_owner                  boolean NOT NULL DEFAULT false, -- admin en todos los locales de su organización
  password_changed_at       timestamptz NOT NULL DEFAULT now(),
  failed_login_count        integer NOT NULL DEFAULT 0,
  failed_login_window_start timestamptz,                    -- bloqueo: 5 fallos en 15 min
  -- AUDIT
  deactivated_at            timestamptz,
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX uq_app_users_username ON core.app_users (organization_id, username) WHERE deactivated_at IS NULL;

CREATE TABLE core.location_memberships (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  location_id     uuid NOT NULL,
  roles           core.location_role[] NOT NULL CHECK (cardinality(roles) > 0),
  -- AUDIT
  deactivated_at  timestamptz,
  -- Usuario y local deben ser de la misma organización (garantizado por la base).
  FOREIGN KEY (user_id, organization_id)     REFERENCES core.app_users (id, organization_id),
  FOREIGN KEY (location_id, organization_id) REFERENCES core.locations (id, organization_id)
);
CREATE UNIQUE INDEX uq_location_memberships ON core.location_memberships (user_id, location_id) WHERE deactivated_at IS NULL;

CREATE TABLE core.sessions (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id                uuid NOT NULL REFERENCES core.app_users (id),
  token_hash             bytea NOT NULL UNIQUE,  -- SHA-256 del token aleatorio de la cookie; el token nunca se guarda
  acting_organization_id uuid REFERENCES core.organizations (id),  -- solo superadmin: negocio sobre el que opera
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,   -- deslizante: 30 días desde el último uso
  revoked_at             timestamptz,
  ip                     inet,
  user_agent             text
);
CREATE INDEX ix_sessions_user_active ON core.sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE core.entitlements (
  organization_id uuid NOT NULL REFERENCES core.organizations (id),
  module          core.module NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  -- AUDIT
  PRIMARY KEY (organization_id, module)
);

-- Acciones administrativas y de superadmin (ADR-002 D3). Se escribe en la misma transacción que el cambio.
CREATE TABLE core.audit_log (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,          -- negocio afectado (no el del superadmin)
  actor_user_id   uuid NOT NULL,
  action          text NOT NULL,          -- 'user.created', 'user.password_reset', 'session.acting_organization_selected', …
  target_type     text NOT NULL,
  target_id       uuid,
  details         jsonb NOT NULL DEFAULT '{}',
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_log_org ON core.audit_log (organization_id, occurred_at DESC);
```

**Reglas de `core`:**
- Superadmin = usuario activo de la organización con `is_platform = true`. Recibe todos los permisos; no necesita membresías ni entitlements.
- Slugs reservados (validados en la API): `labs` (plataforma), `api`, `sim`, `assets`, `login`, `static`.
- Cambiar la contraseña o desactivar un usuario revoca todas sus sesiones (`revoked_at = now()`).
- `last_seen_at`/`expires_at` se actualizan como máximo una vez por hora por sesión, para no escribir en cada petición.

### Permisos (en código, `domains/core/contracts`; no es tabla)

Los guards verifican permisos; los roles solo se traducen a permisos aquí (ADR-002 §3).

| Permiso | `admin` | `staff` | `inventory` |
|---|---|---|---|
| `core.users.manage` | ✓ | | |
| `hospitality.tables.manage` (mesas y zonas) | ✓ | | |
| `hospitality.calls.read` / `.acknowledge` / `.complete` | ✓ | ✓ | |
| `hospitality.devices.status` (¿tiene botón?, ¿conectado?) | ✓ | ✓ | |
| `commerce.catalog.manage` (productos, lugares de stock) | ✓ | | ✓ |
| `commerce.reasons.manage` (motivos de movimiento) | ✓ | | |
| `commerce.stock.read` / `.write` | ✓ | | ✓ |
| `analytics.calls.read` | ✓ | | |
| `analytics.inventory.read` | ✓ | | ✓ |
| `platform.*` (negocios, locales, módulos, gateways, dispositivos, asignaciones) | solo superadmin | | |

## 3. Esquema `hospitality` (propietario: `hospitality-ops`)

```sql
CREATE TYPE hospitality.call_status        AS ENUM ('pending', 'in_progress', 'completed');
CREATE TYPE hospitality.call_type          AS ENUM ('attention');
CREATE TYPE hospitality.call_action        AS ENUM ('create', 'acknowledge', 'complete');
CREATE TYPE hospitality.call_visibility    AS ENUM ('all');  -- extensión: 'assigned'
CREATE TYPE hospitality.transport          AS ENUM ('http', 'mqtt');
CREATE TYPE hospitality.device_event_result AS ENUM (
  'call_created',      -- creó una solicitud nueva
  'repeat_press',      -- había solicitud activa: sumó a press_count
  'debounced',         -- misma señal del mismo botón en menos de 3 s
  'unknown_device',    -- código no registrado en el local
  'unassigned_device', -- botón registrado sin mesa asignada
  'location_inactive'  -- local o negocio desactivado: se registra la señal, sin llamado
);

CREATE TABLE hospitality.location_settings (
  location_id     uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  call_visibility hospitality.call_visibility NOT NULL DEFAULT 'all',
  -- AUDIT
);

CREATE TABLE hospitality.zones (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  name            text NOT NULL,
  position        integer NOT NULL DEFAULT 0,
  -- AUDIT
  deactivated_at  timestamptz,
  UNIQUE (id, location_id)
);
CREATE UNIQUE INDEX uq_zones_name ON hospitality.zones (location_id, lower(name)) WHERE deactivated_at IS NULL;

CREATE TABLE hospitality.dining_tables (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  zone_id         uuid,                       -- opcional: locales sin zonas
  label           text NOT NULL,              -- "5", "Mesa 5", "Barra 2"
  position        integer NOT NULL DEFAULT 0, -- orden en el tablero
  -- AUDIT
  deactivated_at  timestamptz,
  UNIQUE (id, location_id),
  FOREIGN KEY (zone_id, location_id) REFERENCES hospitality.zones (id, location_id)
);
-- Mismo número permitido en zonas distintas; nunca dentro de la misma zona (ni dos "sin zona" iguales).
CREATE UNIQUE INDEX uq_dining_tables_label
  ON hospitality.dining_tables (location_id, zone_id, lower(label)) NULLS NOT DISTINCT
  WHERE deactivated_at IS NULL;

CREATE TABLE hospitality.gateways (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  name            text NOT NULL,
  key_hash        bytea NOT NULL UNIQUE,  -- SHA-256 de la clave HTTP; la clave se muestra una sola vez al crearla
  last_seen_at    timestamptz,            -- señal de vida cada 30 s; "desconectado" si > 90 s
  -- AUDIT
  deactivated_at  timestamptz,
  UNIQUE (id, location_id)
);
-- MQTT: el usuario del broker es el id del gateway; el tópico es modivara/gw/<gateway_id>/press.
-- ponytail: credenciales MQTT gestionadas con mosquitto_passwd + ACL "pattern write modivara/gw/%u/#";
--           pasar a plugin de autenticación del broker contra la API cuando haya varios clientes.

CREATE TABLE hospitality.devices (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  code            text NOT NULL,  -- identificador que envía el botón/gateway
  model           text,           -- referencia de hardware; define la traducción tecla → call_type en el adaptador
  -- AUDIT
  deactivated_at  timestamptz,
  UNIQUE (id, location_id)
);
CREATE UNIQUE INDEX uq_devices_code ON hospitality.devices (location_id, code) WHERE deactivated_at IS NULL;

CREATE TABLE hospitality.device_assignments (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  device_id       uuid NOT NULL,
  table_id        uuid NOT NULL,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  assigned_by     uuid NOT NULL,
  unassigned_at   timestamptz,
  unassigned_by   uuid,
  FOREIGN KEY (device_id, location_id) REFERENCES hospitality.devices (id, location_id),
  FOREIGN KEY (table_id, location_id)  REFERENCES hospitality.dining_tables (id, location_id),
  CHECK ((unassigned_at IS NULL) = (unassigned_by IS NULL))
);
-- Un botón en una sola mesa a la vez; una mesa puede tener varios botones.
CREATE UNIQUE INDEX uq_device_assignments_active ON hospitality.device_assignments (device_id) WHERE unassigned_at IS NULL;
CREATE INDEX ix_device_assignments_table ON hospitality.device_assignments (table_id) WHERE unassigned_at IS NULL;

CREATE TABLE hospitality.service_calls (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  table_id        uuid NOT NULL,
  call_type       hospitality.call_type NOT NULL DEFAULT 'attention',
  status          hospitality.call_status NOT NULL DEFAULT 'pending',
  press_count     integer NOT NULL DEFAULT 1 CHECK (press_count >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_press_at   timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  completed_at    timestamptz,
  completed_by    uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (table_id, location_id) REFERENCES hospitality.dining_tables (id, location_id),
  -- El estado y sus fechas no pueden contradecirse.
  CHECK (
    (status = 'pending'     AND acknowledged_at IS NULL     AND completed_at IS NULL) OR
    (status = 'in_progress' AND acknowledged_at IS NOT NULL AND completed_at IS NULL) OR
    (status = 'completed'   AND acknowledged_at IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
  CHECK ((completed_at IS NULL) = (completed_by IS NULL))
);
-- ADR-002 D4: una solicitud activa por mesa y por tipo.
CREATE UNIQUE INDEX uq_service_calls_active
  ON hospitality.service_calls (table_id, call_type)
  WHERE status IN ('pending', 'in_progress');
CREATE INDEX ix_service_calls_board   ON hospitality.service_calls (location_id) WHERE status IN ('pending', 'in_progress');
CREATE INDEX ix_service_calls_history ON hospitality.service_calls (location_id, created_at DESC);

CREATE TABLE hospitality.service_call_transitions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  service_call_id uuid NOT NULL REFERENCES hospitality.service_calls (id),
  action          hospitality.call_action NOT NULL,
  from_status     hospitality.call_status,          -- NULL en 'create'
  to_status       hospitality.call_status NOT NULL,
  actor_user_id   uuid,                              -- NULL cuando el origen es un botón
  device_event_id uuid,                              -- origen físico de 'create'
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_user_id IS NOT NULL OR device_event_id IS NOT NULL)
);
CREATE INDEX ix_service_call_transitions_call ON hospitality.service_call_transitions (service_call_id, occurred_at);

CREATE TABLE hospitality.device_events (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  gateway_id      uuid NOT NULL,
  device_id       uuid,                              -- NULL si el código no está registrado
  device_code     text NOT NULL,                     -- código crudo recibido
  button_key      text,                              -- tecla cruda (botones con varias teclas)
  transport       hospitality.transport NOT NULL,
  payload         jsonb NOT NULL,                    -- mensaje original completo
  sent_at         timestamptz,                       -- reloj del gateway: no confiable, solo informativo
  received_at     timestamptz NOT NULL DEFAULT now(),-- inicio medible oficial (TECH-001 §8)
  result          hospitality.device_event_result NOT NULL,
  service_call_id uuid REFERENCES hospitality.service_calls (id),
  correlation_id  uuid NOT NULL,
  FOREIGN KEY (gateway_id, location_id) REFERENCES hospitality.gateways (id, location_id)
);
CREATE INDEX ix_device_events_device  ON hospitality.device_events (device_id, received_at DESC);
CREATE INDEX ix_device_events_unknown ON hospitality.device_events (location_id, received_at DESC) WHERE result = 'unknown_device';

-- outbox_events: ver §6.
```

### Flujo transaccional de una pulsación

1. El adaptador (HTTP o MQTT) autentica el gateway (`key_hash` o usuario del broker) → obtiene `organization_id`, `location_id`, `gateway_id`. **Nada de tenant viene del mensaje.** Traduce la tecla a `call_type`.
2. Busca el dispositivo activo por `(location_id, code)`. Si no existe → `device_event` con `unknown_device`, sin más efectos (aparece en la consola del superadmin). Si no tiene asignación activa → `unassigned_device`.
   Si el local o su negocio está inactivo → `location_inactive`, sin llamado.
3. En una transacción (puerto transaccional acotado `withDeviceLock`, TECH-001 §5 v1.4; el `device_event` se escribe en la **misma** transacción con cualquier resultado, para no perder ninguna señal):
   - `pg_advisory_xact_lock` por `device_id` (serializa señales simultáneas del mismo botón).
   - Si el último evento del dispositivo con resultado `call_created`/`repeat_press` tiene menos de 3 s → `debounced`.
     `ponytail:` ventana fija de 3 s; calibrar con el hardware real.
   - Si no, inserta o reutiliza la solicitud activa de forma atómica:
     ```sql
     INSERT INTO hospitality.service_calls (organization_id, location_id, table_id, call_type)
     VALUES ($org, $loc, $table, $type)
     ON CONFLICT (table_id, call_type) WHERE status IN ('pending', 'in_progress')
     DO UPDATE SET press_count = service_calls.press_count + 1, last_press_at = now(), updated_at = now()
     RETURNING id, (xmax = 0) AS created;
     ```
   - Si `created` → transición `create` + `outbox_events` (`hospitality.service_call.created.v1`). El `device_event` queda `call_created`; si no, `repeat_press`.
4. Después del commit: aviso por Socket.IO a la sala del local (`NotificationPort`).

### Reconocer y finalizar

La función de transiciones (tabla `TRANSITIONS`, TECH-001 §16) valida la acción; la base protege la concurrencia:

```sql
UPDATE hospitality.service_calls
SET status = 'in_progress', acknowledged_at = now(), acknowledged_by = $user, updated_at = now()
WHERE id = $id AND status = 'pending'
RETURNING *;
-- 0 filas → otro usuario ya lo reconoció: responder 409 con el estado actual.
```

En la misma transacción: transición + outbox (`acknowledged.v1` / `completed.v1`, con `press_count` final).

### 3.1 Planos de espacios (v1.3, ADR-003 §17)

Los espacios son las `zones`; un plano con `zone_id = NULL` es el espacio único del local. Migración `0003_space_layouts`.

```sql
CREATE TYPE hospitality.layout_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE hospitality.space_layouts (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  zone_id         uuid,                       -- NULL = espacio único del local
  version         integer NOT NULL,           -- 0 mientras es borrador; max + 1 al publicar
  status          hospitality.layout_status NOT NULL,
  canvas_width    integer NOT NULL CHECK (canvas_width BETWEEN 1 AND 10000),
  canvas_height   integer NOT NULL CHECK (canvas_height BETWEEN 1 AND 10000),
  elements        jsonb NOT NULL CHECK (jsonb_typeof(elements) = 'array'),  -- validado con Zod (máx. 500)
  revision        integer NOT NULL,           -- concurrencia optimista del borrador
  -- AUDIT
  published_at    timestamptz,
  published_by    uuid,
  FOREIGN KEY (zone_id, location_id) REFERENCES hospitality.zones (id, location_id)
  -- CHECK: estado coherente con version y published_at/published_by
);
-- Por espacio: a lo sumo un borrador y un publicado; versiones únicas.
-- Índices únicos parciales sobre (location_id, zone_id) NULLS NOT DISTINCT por estado, y (location_id, zone_id, version) para los no borradores.
```

- Elementos: `table` (`table_id`, `shape` `round|square|rect`), `wall`, `door`, `bar` (caja `x, y, width, height, rotation`) y `label` (`text` ≤ 60). Cada uno lleva un `id` de cliente.
- Una mesa solo puede ir en el plano de su propia zona, y no puede repetirse en un plano. Se valida al guardar y otra vez al publicar, dentro de la transacción y con `FOR SHARE` de las mesas. Con un solo plano publicado por espacio, eso da la unicidad global sin restricción entre planos.
- Publicar: `FOR UPDATE` del borrador, comprobación de `revision`, el publicado anterior pasa a `archived` y el borrador a `published`. Las versiones archivadas se conservan.
- Al leer los planos publicados se omiten las mesas inactivas o de otra zona (pasan a «Sin ubicar») y los planos de zonas desactivadas.

## 4. Esquema `commerce` (propietario: `commerce`)

```sql
CREATE TYPE commerce.unit               AS ENUM ('unit', 'bottle', 'kg', 'g', 'l', 'ml');
CREATE TYPE commerce.movement_direction AS ENUM ('in', 'out', 'adjust');

CREATE TABLE commerce.products (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,  -- catálogo por local: dos locales del mismo negocio pueden tener catálogos distintos (§8.3)
  name            text NOT NULL,
  sku             text,
  category        text,
  unit            commerce.unit NOT NULL,
  -- AUDIT
  deactivated_at  timestamptz,
  UNIQUE (id, location_id)
);
CREATE UNIQUE INDEX uq_products_name ON commerce.products (location_id, lower(name)) WHERE deactivated_at IS NULL;
CREATE UNIQUE INDEX uq_products_sku  ON commerce.products (location_id, sku) WHERE sku IS NOT NULL AND deactivated_at IS NULL;

CREATE TABLE commerce.stock_locations (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  name            text NOT NULL,  -- "Principal" se crea con el local
  is_default      boolean NOT NULL DEFAULT false,
  -- AUDIT
  deactivated_at  timestamptz,
  UNIQUE (id, location_id)
);
CREATE UNIQUE INDEX uq_stock_locations_name    ON commerce.stock_locations (location_id, lower(name)) WHERE deactivated_at IS NULL;
CREATE UNIQUE INDEX uq_stock_locations_default ON commerce.stock_locations (location_id) WHERE is_default AND deactivated_at IS NULL;

CREATE TABLE commerce.movement_reasons (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL,
  name            text NOT NULL,
  direction       commerce.movement_direction NOT NULL,
  -- AUDIT
  deactivated_at  timestamptz,
  UNIQUE (id, direction)
);
CREATE UNIQUE INDEX uq_movement_reasons_name ON commerce.movement_reasons (organization_id, lower(name)) WHERE deactivated_at IS NULL;

CREATE TABLE commerce.stock_balances (
  stock_location_id uuid NOT NULL,
  product_id        uuid NOT NULL,
  organization_id   uuid NOT NULL,
  location_id       uuid NOT NULL,
  quantity          numeric(12,3) NOT NULL CHECK (quantity >= 0),  -- ponytail: sin negativos (provisional, TECH-001 §16.8)
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stock_location_id, product_id),
  FOREIGN KEY (stock_location_id, location_id) REFERENCES commerce.stock_locations (id, location_id),
  FOREIGN KEY (product_id, location_id)        REFERENCES commerce.products (id, location_id)
);

CREATE TABLE commerce.stock_movements (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL,
  location_id       uuid NOT NULL,
  stock_location_id uuid NOT NULL,
  product_id        uuid NOT NULL,
  direction         commerce.movement_direction NOT NULL,
  reason_id         uuid NOT NULL,
  delta             numeric(12,3) NOT NULL,  -- con signo: entrada > 0, salida < 0, ajuste ≠ 0
  balance_after     numeric(12,3) NOT NULL,
  note              text,
  actor_user_id     uuid NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  idempotency_key   uuid NOT NULL,
  -- Lugar de stock y producto del mismo local que el movimiento.
  FOREIGN KEY (stock_location_id, location_id) REFERENCES commerce.stock_locations (id, location_id),
  FOREIGN KEY (product_id, location_id)        REFERENCES commerce.products (id, location_id),
  -- El motivo debe tener la misma dirección que el movimiento.
  FOREIGN KEY (reason_id, direction) REFERENCES commerce.movement_reasons (id, direction),
  CHECK (
    (direction = 'in'     AND delta > 0) OR
    (direction = 'out'    AND delta < 0) OR
    (direction = 'adjust' AND delta <> 0)
  ),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX ix_stock_movements_product ON commerce.stock_movements (stock_location_id, product_id, occurred_at DESC);

-- outbox_events: ver §6.
```

**Motivos sembrados por negocio** (editables por `admin`):

| Dirección | Motivos |
|---|---|
| `in` | Compra, Devolución de cliente |
| `out` | Venta, Merma, Rotura, Vencimiento, Cortesía, Consumo interno, Devolución a proveedor |
| `adjust` | Corrección de conteo |

**Movimiento (una transacción, puerto transaccional acotado `withLockedBalance`, TECH-001 §5 v1.4):** primero el saldo, de forma atómica; luego el movimiento con el saldo resultante.

```sql
-- 1. Garantizar que exista la fila de saldo (en 0).
INSERT INTO commerce.stock_balances (stock_location_id, product_id, organization_id, location_id, quantity)
VALUES ($sl, $p, $org, $loc, 0)
ON CONFLICT (stock_location_id, product_id) DO NOTHING;

-- 2. Aplicar el delta de forma atómica.
UPDATE commerce.stock_balances
SET quantity = quantity + $delta, updated_at = now()
WHERE stock_location_id = $sl AND product_id = $p
RETURNING quantity;  -- viola el CHECK si quedaría negativo → se rechaza el movimiento
```

No usar `INSERT … ON CONFLICT DO UPDATE` con el delta directamente: PostgreSQL valida los `CHECK` sobre la fila propuesta antes de resolver el conflicto, y una salida (delta negativo) fallaría aunque el saldo existente alcance.

- Ajuste por conteo: la UI pide la cantidad contada; la API calcula `delta = contado − saldo` dentro de la transacción (con `SELECT … FOR UPDATE` del saldo).
- `Idempotency-Key` repetida → se devuelve el movimiento existente, sin aplicar dos veces.
- Evento: `commerce.stock.received.v1` (`in`), `commerce.stock.issued.v1` (`out`), `commerce.stock.adjusted.v1` (`adjust`).

## 5. Esquema `analytics` (propietario: `analytics`)

Proyecciones propias, construidas solo a partir de eventos (TECH-001 §16). Nunca lee tablas de otros esquemas.

```sql
CREATE TABLE analytics.processed_events (
  event_id     uuid PRIMARY KEY,  -- deduplicación: entrega at-least-once
  event_type   text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics.service_call_facts (
  service_call_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  table_id        uuid NOT NULL,
  table_label     text NOT NULL,  -- copia al momento del llamado
  zone_id         uuid,
  zone_name       text,
  call_type       text NOT NULL,
  created_at      timestamptz NOT NULL,
  acknowledged_at timestamptz,
  completed_at    timestamptz,
  press_count     integer NOT NULL DEFAULT 1
);
CREATE INDEX ix_service_call_facts_period ON analytics.service_call_facts (location_id, created_at);

CREATE TABLE analytics.stock_movement_facts (
  movement_id       uuid PRIMARY KEY,
  organization_id   uuid NOT NULL,
  location_id       uuid NOT NULL,
  stock_location_id uuid NOT NULL,
  product_id        uuid NOT NULL,
  product_name      text NOT NULL,
  direction         text NOT NULL,
  reason_id         uuid NOT NULL,
  reason_name       text NOT NULL,
  delta             numeric(12,3) NOT NULL,
  balance_after     numeric(12,3) NOT NULL,
  occurred_at       timestamptz NOT NULL
);
CREATE INDEX ix_stock_movement_facts_period ON analytics.stock_movement_facts (location_id, occurred_at);
```

- Tiempos de reconocimiento y cierre: `acknowledged_at − created_at` y `completed_at − created_at`, calculados al consultar.
- Agrupación por hora/día: `date_trunc(..., created_at AT TIME ZONE <timezone del local>)`; la zona horaria se obtiene vía `CoreAccessPort`.
- Saldo actual por producto: último `balance_after` por `(stock_location_id, product_id)` (`DISTINCT ON`).
- **Eventos desordenados (decisión 20/10/2026):** si `acknowledged`/`completed` llega antes que `created`, el suscriptor lo rechaza con un error reintentable sin marcarlo procesado, y el poller lo reintenta; los facts se crean siempre completos (columnas `NOT NULL`). Política de dead-letter tras N reintentos: pendiente.
- **Reconstrucción (v1.2, PLAN-001 Q-09):** `pnpm analytics:rebuild` hace `TRUNCATE` de las tres tablas y reprocesa el historial en una sola transacción. El historial lo da cada emisor por un puerto de lectura (`EventHistoryReader`) declarado en su `contracts`; ese puerto lee su propio `outbox_events`, incluidos los despachados y los detenidos. Los historiales se mezclan por `(occurred_at, event_id)`. Un evento inválido revierte todo e informa su `event_id`.
- **Series por periodo (v1.2):** las consultas devuelven todas las horas o días del rango, en 0 los que no tienen datos, hasta la cubeta actual.

## 6. Outbox (misma forma en `core`, `hospitality` y `commerce`)

> **v1.2:** `core` también tiene outbox (`core.organization.created.v1`, `core.location.created.v1`, PLAN-001 Q-05). Las tres tablas tienen además `failed_at timestamptz` (migración `0002`).

```sql
CREATE TABLE <schema>.outbox_events (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),  -- = event_id
  event_type      text NOT NULL,                      -- 'hospitality.service_call.created'
  event_version   integer NOT NULL,                   -- 1
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL,
  location_id     uuid NOT NULL,
  aggregate_id    uuid NOT NULL,
  correlation_id  uuid NOT NULL,
  causation_id    uuid,
  payload         jsonb NOT NULL,
  dispatched_at   timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_outbox_pending ON <schema>.outbox_events (next_attempt_at) WHERE dispatched_at IS NULL;
```

- El poller toma lotes con `FOR UPDATE SKIP LOCKED`, entrega a los suscriptores y marca `dispatched_at`. Si un suscriptor falla: `attempts + 1`, `next_attempt_at` con espera creciente. **v1.2:** tras 10 intentos fallidos el evento queda con `failed_at` (conserva `last_error`) y el poller deja de tomarlo; `pnpm outbox:retry <dominio> [event_id]` lo libera.
- Los suscriptores deduplican por `event_id` (`analytics.processed_events`).
- Los eventos despachados **no se borran** durante el piloto (reconstrucción de proyecciones). La retención queda pendiente (TECH-001 §14).

### Payloads v1

| Evento | `payload` |
|---|---|
| `hospitality.service_call.created.v1` | `service_call_id, table_id, table_label, zone_id, zone_name, call_type, created_at` |
| `hospitality.service_call.acknowledged.v1` | `service_call_id, acknowledged_at, acknowledged_by, press_count` |
| `hospitality.service_call.completed.v1` | `service_call_id, completed_at, completed_by, press_count` |
| `commerce.stock.received.v1` / `.issued.v1` / `.adjusted.v1` | `movement_id, stock_location_id, product_id, product_name, reason_id, reason_name, delta, balance_after, occurred_at, actor_user_id` |

Los tipos de estos payloads viven en el `contracts` del dominio emisor, validados con Zod.

## 7. Datos de demo (seed)

El seed usa los mismos servicios de dominio (no inserta SQL directo en tablas de otros dominios), de modo que también genera eventos y proyecciones:

- Organización de plataforma `labs` con un superadmin.
- "Bar Demo" (`/bar-demo`): 15 mesas sin zonas, `admin`, `barra` (staff), `mesero1` (staff), `inventario1` (inventory), un gateway, 15 botones simulados asignados.
- "Bar Demo Pisos" (`/bar-demo-pisos`): zonas Terraza y 2º piso, con mesas repetidas por zona.
- Unos 10 productos con stock inicial y motivos sembrados.
- Dos semanas de llamados y movimientos históricos generados para que las métricas tengan datos.

## 8. Revisión (resuelta el 20/10/2026)

1. `slug` 3–40 y `username` 3–32 caracteres: **confirmado**.
2. El tablero se ordena por `position` de zonas y mesas: **confirmado**.
3. Catálogo de productos: **por local** (`commerce.products.location_id`); los motivos de movimiento siguen por negocio.

Siguen pendientes (no bloquean la primera migración): almacenamiento del límite de intentos por IP (TECH-001 §16.3), origen del historial para reconstruir analytics (PLAN-001 Q-09) y política de dead-letter. **v1.2:** el origen del historial de analytics y el dead-letter de los pollers ya están resueltos (§5, §6). Sigue pendiente la política para eventos envenenados de analytics.

## 9. Control de cambios

- **1.0 (19/10/2026):** propuesta inicial.
- **1.3 (28/10/2026):** §3.1, planos de espacios (`space_layouts`, ADR-003 §17).
- **1.2 (27/10/2026):** sincronizado con el código: outbox de `core`, `failed_at` y el tope de 10 intentos (§6), reconstrucción de analytics por puerto de historial (§5, Q-09) y series por periodo con ceros (§5). Sin tablas nuevas.
- **1.1 (20/10/2026):** §8 resuelto; ids generados en la aplicación y roles por esquema (§1); `core.audit_log` (§2, ADR-002 D3); `location_inactive` y transacción acotada de la pulsación (§3); catálogo por local y FK compuestas `(x_id, location_id)` que exige §1 (§3 `device_events`→`gateways`; §4 saldos y movimientos→lugares y productos); eventos desordenados (§5); referencia del `CHECK` de saldo corregida a TECH-001 §16.8.
