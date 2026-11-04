# DATA-002 — Modelo de datos as-built

> **Estado:** descriptivo (no es un ADR). **DATA-001 queda como decisión histórica; este documento describe lo construido a la fecha (commit `197b260`, 03/11/2026).**
> **Fuente:** las migraciones `domains/*/api/src/infrastructure/prisma/migrations/*/migration.sql` aplicadas en orden (los `schema.prisma` de cada dominio declaran el mismo conjunto: core 8 modelos y 2 enums, hospitality 11 y 7 (con `space_layouts` y `layout_status`), commerce 6 y 2, analytics 3 y 0: 28 tablas en total) y `infra/postgres/init-schemas.sh`. Las tablas de abajo se generaron con un script desechable que lee el SQL; no hay base viva consultada.
> **Cómo mantenerlo:** al añadir una migración, actualizar la tabla afectada y «Diferencias con DATA-001» si cambia una decisión.

## Convenciones que se cumplen en todas las migraciones

- Esquema y rol por dominio. Un esquema de PostgreSQL por dominio; sin FK entre esquemas (todas las FK de abajo apuntan al mismo esquema). `location_id` de hospitality/commerce/analytics es un `uuid` sin FK hacia `core.locations`.
- Ids `UUID` con `DEFAULT uuidv7()` como respaldo; la aplicación los genera (`newId()` de `core-contracts`, DATA-001 §1). Tiempos `TIMESTAMPTZ`; `CURRENT_TIMESTAMP` como default.
- FK compuestas `(x_id, location_id)` / `(x_id, organization_id)` dentro del esquema para impedir mezclar locales o negocios; por eso existen los índices únicos `uq_*_id_location` / `uq_*_id_org`. Todas son `ON DELETE RESTRICT ON UPDATE CASCADE` salvo las dos marcadas `SET NULL`.
- «Auditoría de configuración»: `created_at, updated_at, created_by, updated_by` (en las tablas que lo llevan, aparecen explícitas abajo). `deactivated_at` en vez de borrar.
- Los enums de PostgreSQL se crean sin prefijo de esquema en el SQL; Prisma los ubica en el esquema del dominio vía `?schema=<dominio>`.
- No cubre la tabla `_prisma_migrations` de Prisma (una por esquema; no verificado aquí porque requiere una base viva).

## Roles (`infra/postgres/init-schemas.sh`)

Para cada `d` en `core, hospitality, commerce, analytics`, una sola vez al crear el volumen:

- `CREATE ROLE <d>_app LOGIN PASSWORD <D>_DB_PASSWORD` (variable de entorno).
- `CREATE SCHEMA <d> AUTHORIZATION <d>_app`: el rol es **dueño** de su esquema y de lo que cree ahí.
- `REVOKE ALL ON SCHEMA public FROM <d>_app`.
- No hay `GRANT` a otros esquemas: un dominio no puede leer otro por SQL.
- El mismo rol migra y opera (comentario `ponytail` del script). Separar rol de migración queda pendiente (BACKLOG-001 SEC-09, M.5).
- Los roles solo existen si se crea el volumen con ese script; sobre una base ya existente no se vuelven a crear (no verificado más allá de leer el script).

## Esquema `core`

Enums: `location_role` (admin, staff, inventory); `module` (hospitality, commerce, analytics)

### `core.organizations`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `slug` | TEXT | no |  |
| `name` | TEXT | no |  |
| `is_platform` | BOOLEAN | no | `false` |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

Índices:
- `uq_organizations_slug` ÚNICO (slug)
- `uq_organizations_single_platform` ÚNICO (is_platform) WHERE (is_platform)

CHECK:
- `ck_organizations_slug`: (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 40)

### `core.locations`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `name` | TEXT | no |  |
| `timezone` | TEXT | no | `'America/Bogota'` |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

FKs: `(organization_id) → organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE`

Índices:
- `uq_locations_id_org` ÚNICO (id, organization_id)
- `uq_locations_name` ÚNICO (organization_id, lower(name)) WHERE deactivated_at IS NULL

### `core.app_users`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `username` | TEXT | no |  |
| `display_name` | TEXT | no |  |
| `password_hash` | TEXT | no |  |
| `is_owner` | BOOLEAN | no | `false` |
| `password_changed_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `failed_login_count` | INTEGER | no | `0` |
| `failed_login_window_start` | TIMESTAMPTZ | sí |  |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

FKs: `(organization_id) → organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE`

Índices:
- `uq_app_users_id_org` ÚNICO (id, organization_id)
- `uq_app_users_username` ÚNICO (organization_id, username) WHERE (deactivated_at IS NULL)

CHECK:
- `ck_app_users_username`: (username ~ '^[a-z0-9._-]{3,32}$')

### `core.location_memberships`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `user_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `roles` | location_role[] | no |  |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

FKs: `(user_id, organization_id) → app_users(id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE`; `(location_id, organization_id) → locations(id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE`

Índices:
- `uq_location_memberships` ÚNICO (user_id, location_id) WHERE (deactivated_at IS NULL)

CHECK:
- `ck_location_memberships_roles`: (cardinality(roles) > 0)

### `core.sessions`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `user_id` | UUID | no |  |
| `token_hash` | BYTEA | no |  |
| `acting_organization_id` | UUID | sí |  |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `last_seen_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `expires_at` | TIMESTAMPTZ | no |  |
| `revoked_at` | TIMESTAMPTZ | sí |  |
| `ip` | INET | sí |  |
| `user_agent` | TEXT | sí |  |

FKs: `(user_id) → app_users(id) ON DELETE RESTRICT ON UPDATE CASCADE`; `(acting_organization_id) → organizations(id) ON DELETE SET NULL ON UPDATE CASCADE`

Índices:
- `uq_sessions_token_hash` ÚNICO (token_hash)
- `ix_sessions_user_active` (user_id) WHERE (revoked_at IS NULL)

### `core.entitlements`

PK: `organization_id,module`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `organization_id` | UUID | no |  |
| `module` | module | no |  |
| `enabled` | BOOLEAN | no | `true` |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |

FKs: `(organization_id) → organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE`

### `core.audit_log`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `actor_user_id` | UUID | no |  |
| `action` | TEXT | no |  |
| `target_type` | TEXT | no |  |
| `target_id` | UUID | sí |  |
| `details` | JSONB | no | `'{}'` |
| `occurred_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |

Índices:
- `ix_audit_log_org` (organization_id, occurred_at DESC)

### `core.outbox_events`

PK: `id`. Creada en `0002_outbox_events`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `event_type` | TEXT | no |  |
| `event_version` | INTEGER | no |  |
| `occurred_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `aggregate_id` | UUID | no |  |
| `correlation_id` | UUID | no |  |
| `causation_id` | UUID | sí |  |
| `payload` | JSONB | no |  |
| `dispatched_at` | TIMESTAMPTZ | sí |  |
| `attempts` | INTEGER | no | `0` |
| `last_error` | TEXT | sí |  |
| `next_attempt_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `failed_at` | TIMESTAMPTZ | sí |  |

Índices:
- `ix_outbox_pending` (next_attempt_at) WHERE (dispatched_at IS NULL AND failed_at IS NULL)

## Esquema `hospitality`

Enums: `call_status` (pending, in_progress, completed); `call_type` (attention); `call_action` (create, acknowledge, complete); `call_visibility` (all); `transport` (http, mqtt); `device_event_result` (call_created, repeat_press, debounced, unknown_device, unassigned_device, location_inactive); `layout_status` (draft, published, archived)

### `hospitality.location_settings`

PK: `location_id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `location_id` | UUID | no |  |
| `organization_id` | UUID | no |  |
| `call_visibility` | call_visibility | no | `'all'` |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |

### `hospitality.zones`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `name` | TEXT | no |  |
| `position` | INTEGER | no | `0` |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

Índices:
- `uq_zones_id_location` ÚNICO (id, location_id)
- `uq_zones_name` ÚNICO (location_id, lower(name)) WHERE deactivated_at IS NULL

### `hospitality.dining_tables`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `zone_id` | UUID | sí |  |
| `label` | TEXT | no |  |
| `position` | INTEGER | no | `0` |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

FKs: `(zone_id, location_id) → zones(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`

Índices:
- `uq_dining_tables_id_location` ÚNICO (id, location_id)
- `uq_dining_tables_label` ÚNICO (location_id, zone_id, lower(label)) NULLS NOT DISTINCT WHERE deactivated_at IS NULL

### `hospitality.gateways`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `name` | TEXT | no |  |
| `key_hash` | BYTEA | no |  |
| `last_seen_at` | TIMESTAMPTZ | sí |  |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

Índices:
- `uq_gateways_key_hash` ÚNICO (key_hash)
- `uq_gateways_id_location` ÚNICO (id, location_id)

### `hospitality.devices`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `code` | TEXT | no |  |
| `model` | TEXT | sí |  |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

Índices:
- `uq_devices_id_location` ÚNICO (id, location_id)
- `uq_devices_code` ÚNICO (location_id, code) WHERE (deactivated_at IS NULL)

### `hospitality.device_assignments`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `device_id` | UUID | no |  |
| `table_id` | UUID | no |  |
| `assigned_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `assigned_by` | UUID | no |  |
| `unassigned_at` | TIMESTAMPTZ | sí |  |
| `unassigned_by` | UUID | sí |  |

FKs: `(device_id, location_id) → devices(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`; `(table_id, location_id) → dining_tables(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`

Índices:
- `ix_device_assignments_table` (table_id) WHERE (unassigned_at IS NULL)
- `uq_device_assignments_active` ÚNICO (device_id) WHERE (unassigned_at IS NULL)

CHECK:
- `ck_device_assignments_closed`: ((unassigned_at IS NULL) = (unassigned_by IS NULL))

### `hospitality.service_calls`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `table_id` | UUID | no |  |
| `call_type` | call_type | no | `'attention'` |
| `status` | call_status | no | `'pending'` |
| `press_count` | INTEGER | no | `1` |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `last_press_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `acknowledged_at` | TIMESTAMPTZ | sí |  |
| `acknowledged_by` | UUID | sí |  |
| `completed_at` | TIMESTAMPTZ | sí |  |
| `completed_by` | UUID | sí |  |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |

FKs: `(table_id, location_id) → dining_tables(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`

Índices:
- `ix_service_calls_board` (location_id) WHERE (status = ANY (ARRAY['pending'::call_status, 'in_progress'::call_status]))
- `ix_service_calls_history` (location_id, created_at DESC)
- `uq_service_calls_active` ÚNICO (table_id, call_type) WHERE (status = ANY (ARRAY['pending'::call_status, 'in_progress'::call_status]))

CHECK:
- `ck_service_calls_press_count`: (press_count >= 1)
- `ck_service_calls_status_dates`: ( (status = 'pending' AND acknowledged_at IS NULL AND completed_at IS NULL) OR (status = 'in_progress' AND acknowledged_at IS NOT NULL AND completed_at IS NULL) OR (status = 'completed' AND acknowledged_at IS NOT NULL AND completed_at IS NOT NULL) )
- `ck_service_calls_acknowledged_actor`: ((acknowledged_at IS NULL) = (acknowledged_by IS NULL))
- `ck_service_calls_completed_actor`: ((completed_at IS NULL) = (completed_by IS NULL))

### `hospitality.service_call_transitions`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `service_call_id` | UUID | no |  |
| `action` | call_action | no |  |
| `from_status` | call_status | sí |  |
| `to_status` | call_status | no |  |
| `actor_user_id` | UUID | sí |  |
| `device_event_id` | UUID | sí |  |
| `occurred_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |

FKs: `(service_call_id) → service_calls(id) ON DELETE RESTRICT ON UPDATE CASCADE`

Índices:
- `ix_service_call_transitions_call` (service_call_id, occurred_at)

CHECK:
- `ck_service_call_transitions_origin`: (actor_user_id IS NOT NULL OR device_event_id IS NOT NULL)

### `hospitality.device_events`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `gateway_id` | UUID | no |  |
| `device_id` | UUID | sí |  |
| `device_code` | TEXT | no |  |
| `button_key` | TEXT | sí |  |
| `transport` | transport | no |  |
| `payload` | JSONB | no |  |
| `sent_at` | TIMESTAMPTZ | sí |  |
| `received_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `result` | device_event_result | no |  |
| `service_call_id` | UUID | sí |  |
| `correlation_id` | UUID | no |  |

FKs: `(gateway_id, location_id) → gateways(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`; `(service_call_id) → service_calls(id) ON DELETE SET NULL ON UPDATE CASCADE`

Índices:
- `ix_device_events_device` (device_id, received_at DESC)
- `ix_device_events_unknown` (location_id, received_at DESC) WHERE (result = 'unknown_device')

### `hospitality.outbox_events`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `event_type` | TEXT | no |  |
| `event_version` | INTEGER | no |  |
| `occurred_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `aggregate_id` | UUID | no |  |
| `correlation_id` | UUID | no |  |
| `causation_id` | UUID | sí |  |
| `payload` | JSONB | no |  |
| `dispatched_at` | TIMESTAMPTZ | sí |  |
| `attempts` | INTEGER | no | `0` |
| `last_error` | TEXT | sí |  |
| `next_attempt_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `failed_at` | TIMESTAMPTZ | sí |  |

Índices:
- `ix_outbox_pending` (next_attempt_at) WHERE (dispatched_at IS NULL AND failed_at IS NULL)

### `hospitality.space_layouts`

PK: `id`. Creada en `0003_space_layouts`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `zone_id` | UUID | sí |  |
| `version` | INTEGER | no |  |
| `status` | layout_status | no |  |
| `canvas_width` | INTEGER | no |  |
| `canvas_height` | INTEGER | no |  |
| `elements` | JSONB | no |  |
| `revision` | INTEGER | no |  |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `published_at` | TIMESTAMPTZ | sí |  |
| `published_by` | UUID | sí |  |

FKs: `(zone_id, location_id) → zones(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`

Índices:
- `uq_space_layouts_draft` ÚNICO (location_id, zone_id) NULLS NOT DISTINCT WHERE (status = 'draft'::layout_status)
- `uq_space_layouts_published` ÚNICO (location_id, zone_id) NULLS NOT DISTINCT WHERE (status = 'published'::layout_status)
- `uq_space_layouts_version` ÚNICO (location_id, zone_id, version) NULLS NOT DISTINCT WHERE (status <> 'draft'::layout_status)

CHECK:
- `ck_space_layouts_canvas`: (canvas_width BETWEEN 1 AND 10000 AND canvas_height BETWEEN 1 AND 10000)
- `ck_space_layouts_version`: (revision >= 1 AND ((status = 'draft') = (version = 0)) AND version >= 0)
- `ck_space_layouts_elements`: (jsonb_typeof(elements) = 'array')
- `ck_space_layouts_published`: ((status = 'draft') = (published_at IS NULL) AND (published_at IS NULL) = (published_by IS NULL))

## Esquema `commerce`

Enums: `unit` (unit, bottle, kg, g, l, ml); `movement_direction` (in, out, adjust)

### `commerce.products`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `name` | TEXT | no |  |
| `sku` | TEXT | sí |  |
| `category` | TEXT | sí |  |
| `unit` | unit | no |  |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

Índices:
- `uq_products_id_location` ÚNICO (id, location_id)
- `uq_products_name` ÚNICO (location_id, lower(name)) WHERE deactivated_at IS NULL
- `uq_products_sku` ÚNICO (location_id, sku) WHERE sku IS NOT NULL AND deactivated_at IS NULL

### `commerce.stock_locations`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `name` | TEXT | no |  |
| `is_default` | BOOLEAN | no | `false` |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

Índices:
- `uq_stock_locations_id_location` ÚNICO (id, location_id)
- `uq_stock_locations_name` ÚNICO (location_id, lower(name)) WHERE deactivated_at IS NULL
- `uq_stock_locations_default` ÚNICO (location_id) WHERE is_default AND deactivated_at IS NULL

### `commerce.movement_reasons`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `name` | TEXT | no |  |
| `direction` | movement_direction | no |  |
| `created_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `created_by` | UUID | sí |  |
| `updated_by` | UUID | sí |  |
| `deactivated_at` | TIMESTAMPTZ | sí |  |

Índices:
- `uq_movement_reasons_id_direction` ÚNICO (id, direction)
- `uq_movement_reasons_name` ÚNICO (organization_id, lower(name)) WHERE deactivated_at IS NULL

### `commerce.stock_balances`

PK: `stock_location_id,product_id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `stock_location_id` | UUID | no |  |
| `product_id` | UUID | no |  |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `quantity` | DECIMAL(12,3) | no |  |
| `updated_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |

FKs: `(stock_location_id, location_id) → stock_locations(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`; `(product_id, location_id) → products(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`

CHECK:
- `ck_stock_balances_quantity`: (quantity >= 0)

### `commerce.stock_movements`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `stock_location_id` | UUID | no |  |
| `product_id` | UUID | no |  |
| `direction` | movement_direction | no |  |
| `reason_id` | UUID | no |  |
| `delta` | DECIMAL(12,3) | no |  |
| `balance_after` | DECIMAL(12,3) | no |  |
| `note` | TEXT | sí |  |
| `actor_user_id` | UUID | no |  |
| `occurred_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `idempotency_key` | UUID | no |  |

FKs: `(stock_location_id, location_id) → stock_locations(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`; `(product_id, location_id) → products(id, location_id) ON DELETE RESTRICT ON UPDATE CASCADE`; `(reason_id, direction) → movement_reasons(id, direction) ON DELETE RESTRICT ON UPDATE CASCADE`

Índices:
- `ix_stock_movements_product` (stock_location_id, product_id, occurred_at DESC)
- `uq_stock_movements_idempotency` ÚNICO (organization_id, idempotency_key)

CHECK:
- `ck_stock_movements_delta`: ( (direction = 'in' AND delta > 0) OR (direction = 'out' AND delta < 0) OR (direction = 'adjust' AND delta <> 0) )

### `commerce.outbox_events`

PK: `id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | UUID | no | `uuidv7()` |
| `event_type` | TEXT | no |  |
| `event_version` | INTEGER | no |  |
| `occurred_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `aggregate_id` | UUID | no |  |
| `correlation_id` | UUID | no |  |
| `causation_id` | UUID | sí |  |
| `payload` | JSONB | no |  |
| `dispatched_at` | TIMESTAMPTZ | sí |  |
| `attempts` | INTEGER | no | `0` |
| `last_error` | TEXT | sí |  |
| `next_attempt_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |
| `failed_at` | TIMESTAMPTZ | sí |  |

Índices:
- `ix_outbox_pending` (next_attempt_at) WHERE (dispatched_at IS NULL AND failed_at IS NULL)

## Esquema `analytics`

### `analytics.processed_events`

PK: `event_id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `event_id` | UUID | no |  |
| `event_type` | TEXT | no |  |
| `processed_at` | TIMESTAMPTZ | no | `CURRENT_TIMESTAMP` |

### `analytics.service_call_facts`

PK: `service_call_id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `service_call_id` | UUID | no |  |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `table_id` | UUID | no |  |
| `table_label` | TEXT | no |  |
| `zone_id` | UUID | sí |  |
| `zone_name` | TEXT | sí |  |
| `call_type` | TEXT | no |  |
| `created_at` | TIMESTAMPTZ | no |  |
| `acknowledged_at` | TIMESTAMPTZ | sí |  |
| `completed_at` | TIMESTAMPTZ | sí |  |
| `press_count` | INTEGER | no | `1` |

Índices:
- `ix_service_call_facts_period` (location_id, created_at)

### `analytics.stock_movement_facts`

PK: `movement_id`. Creada en `0001_init`.

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `movement_id` | UUID | no |  |
| `organization_id` | UUID | no |  |
| `location_id` | UUID | no |  |
| `stock_location_id` | UUID | no |  |
| `product_id` | UUID | no |  |
| `product_name` | TEXT | no |  |
| `direction` | TEXT | no |  |
| `reason_id` | UUID | no |  |
| `reason_name` | TEXT | no |  |
| `delta` | DECIMAL(12,3) | no |  |
| `balance_after` | DECIMAL(12,3) | no |  |
| `occurred_at` | TIMESTAMPTZ | no |  |

Índices:
- `ix_stock_movement_facts_period` (location_id, occurred_at)


## Diferencias con DATA-001

DATA-001 (v1.3) ya se había sincronizado con el código en `v1.2` y `v1.3`, así que las diferencias de fondo son pocas. Contraste hecho columna por columna y por nombre de índice/CHECK (script desechable):

| Tema | DATA-001 | Construido |
|---|---|---|
| Tablas | 25 `CREATE TABLE` | 28: las 25 más `outbox_events` en `core`, `hospitality` y `commerce`. DATA-001 §6 la define una sola vez como `<schema>.outbox_events`; en la práctica son tres tablas independientes (no hay una compartida). Mismas columnas. |
| `ix_outbox_pending` | `WHERE dispatched_at IS NULL` (§6) | `WHERE (dispatched_at IS NULL AND failed_at IS NULL)`. Cambió en la migración `0002` de hospitality y commerce y nació así en `0002_outbox_events` de core. La nota v1.2 de DATA-001 menciona `failed_at` pero el SQL del índice no se actualizó. |
| Outbox de `core` | Nota v1.2 | Llega en una migración propia (`0002_outbox_events`), no en `0001_init`. |
| Columnas de auditoría | Abreviadas con `-- AUDIT` | Explícitas en cada tabla; coinciden con la convención (todas las tablas editables por una persona las llevan; `entitlements` no tiene `deactivated_at`). |
| Defaults de tiempo | `now()` | `CURRENT_TIMESTAMP` (equivalente; lo emite Prisma). |
| Nombres de restricciones | `UNIQUE`/`CHECK` en línea, sin nombre | Con nombre: `uq_*`, `ck_*` (listados arriba). Los CHECK de DATA-001 siguen existiendo; los de `service_calls`, `device_assignments`, `service_call_transitions`, `stock_*`, `space_layouts`, `organizations`, `app_users` y `location_memberships` están en `0001_init` / `0003_space_layouts`. |
| `space_layouts` | Comentario: «CHECK: estado coherente con version y published_at/published_by» | Concretado en `ck_space_layouts_version` (borrador ⇔ `version = 0`, `revision >= 1`) y `ck_space_layouts_published` (borrador ⇔ sin `published_at`; `published_at` ⇔ `published_by`). El tope de 500 elementos **no** es CHECK: solo se valida en Zod (DATA-001 ya lo decía así). |
| Áreas | ADR-003 / PORTAL.md | No son tabla ni columna: son elementos `area` dentro de `space_layouts.elements` (jsonb, validado en `hospitality-contracts`). Ver ADR-004 (c). |
| Auditoría cross-domain | `core.audit_log` (ADR-002 D3) | La tabla está en `core`; la llenan los eventos `hospitality.platform_action.recorded` desde la ronda 2 (BACKLOG-001 M.5, `PlatformActionSubscriber`). El esquema de la tabla no cambió. |
| `service_call_facts.zone_*` | `zone_id`, `zone_name` copiados al crear | Igual. No hay columna de área en analytics (las áreas no existen como entidad). |

Sin diferencias en tipos, nulabilidad ni claves primarias entre las 25 tablas comunes (el script comparó solo nombres de columna; tipos y nulabilidad se verificaron leyendo el SQL de las migraciones, no con un diff automático).

Lo que DATA-001 menciona y **no** se puede comprobar en el repo: datos de demo y volumen (`seed`), porque dependen de ejecutar los seeds; retención de `outbox_events` y `device_events` (sin purga: DATA-001 §6, PLAN-001 F6-14 pendiente).
