# OPERACION-001 · Despliegue y recuperación

Operación de Modivara en un VPS con Docker Compose (QA-09, SEC-03). Todo lo que sigue se ejecuta desde la raíz del repo en el VPS.

## 1. Variables de entorno

Se copian de `.env.example` a `.env` (no se versiona). En producción no dejar ningún valor `cambiar-*`.

| Variable | Para qué |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Superusuario del contenedor `db`; solo crea esquemas y roles. |
| `CORE_DB_PASSWORD`, `HOSPITALITY_DB_PASSWORD`, `COMMERCE_DB_PASSWORD`, `ANALYTICS_DB_PASSWORD` | Contraseña del rol `<dominio>_app`. `docker-compose.yml` arma `<DOMINIO>_DATABASE_URL`. Se leen **solo al crear el volumen** (`infra/postgres/init-schemas.sh`): cambiarlas después exige `ALTER ROLE`. |
| `MODIVARA_DOMAINS` | Dominios que compone la API además de core, separados por coma: `hospitality`, `commerce`, `analytics`. Vacía o sin definir = todos (lo de siempre). Un nombre desconocido detiene el arranque con el mensaje `MODIVARA_DOMAINS: dominio desconocido …`. Un dominio fuera de la lista no levanta providers, rutas ni consumidores, no pide su `<DOMINIO>_DATABASE_URL` y `scripts/api-start.sh` no migra su esquema. Debe cubrir los módulos contratados por los negocios de la instalación: habilitar uno que el host no compone deja su activación sin consumidor (recuperación en §9.4). La usa también `analytics:rebuild` (§9.4). |
| `MQTT_PASSWORD` | Usuario `api` del broker (`scripts/mqtt-user.sh api`). Vacía = la API no se suscribe. |
| `DOMAIN` | Solo producción; obligatoria en `docker-compose.prod.yml`. Caddy saca el certificado. |
| `SIM_*`, `SEED_PASSWORD` | Solo demo. El simulador no arranca en producción (perfil `demo`). |
| `BACKUP_PASSPHRASE`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` | Solo para `scripts/backup.sh` (ver §5); no van al `.env` de los contenedores. |

## 2. Despliegue

Requisitos: DNS de `DOMAIN` apuntando al VPS y puertos 80 y 443 abiertos.

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps   # db healthy, api up
```

`Caddyfile.prod` sirve HTTPS, redirige HTTP a HTTPS, publica `/api/*` hacia la API y el portal estático; no expone `/sim`.

## 3. Migraciones y rollback

- `scripts/api-start.sh` (CMD de la imagen `api`) recorre `domains/*/api` y corre `prisma migrate deploy` con la URL de cada dominio antes de levantar la API. Cada despliegue aplica las migraciones pendientes; si una falla, el contenedor no arranca (ver `docker compose logs api`).
- **Prisma no tiene «down».** Rollback de esquema, en este orden de preferencia:
  1. Migración correctiva hacia adelante (`pnpm migration:new`), desplegada normalmente.
  2. Si hubo daño de datos: restaurar el último backup (§5) y desplegar el commit anterior.
- Antes de desplegar una migración destructiva, correr `scripts/backup.sh` a mano.
- Nunca `prisma db push` ni `migrate dev` contra producción.

## 4. Seeds

`seed:core`, `seed:hospitality`, `seed:commerce` y `seed:history` crean usuarios y datos de demo con una contraseña común. Se **niegan a correr con `NODE_ENV=production`** (la imagen `api` lo fija). En producción no se siembra: el primer negocio y el superadmin se crean con los flujos de la aplicación. Comandos de demo en el README.

## 5. Backup y restauración

```sh
export BACKUP_PASSPHRASE='<clave larga, guardada fuera del VPS>'
scripts/backup.sh            # backups/modivara-<UTC>.dump.enc + .counts
scripts/restore-check.sh     # restaura el más reciente en un contenedor desechable y compara conteos
```

- `backup.sh`: `pg_dump -Fc` de toda la base (los 4 esquemas) desde el contenedor `db`, cifrado con `openssl enc -aes-256-cbc -pbkdf2` (nunca queda texto plano en disco), y borra los locales de más de `BACKUP_RETENTION_DAYS` (14 por defecto). Junto al archivo guarda `.counts` con cuentas, negocios, planos publicados, llamados, movimientos de stock y `audit_log`.
- `restore-check.sh`: descifra, crea un PostgreSQL desechable (`modivara-restore-test`, se borra al terminar), restaura y compara los conteos; sale con código distinto de 0 si no cuadran o si la restauración falla.
- Los roles `<dominio>_app` no van en el dump: se recrean con `init-schemas.sh` al crear el volumen (mismas contraseñas del `.env`).

**Restauración real** (VPS nuevo o base dañada): levantar solo `db` con volumen nuevo (corre `init-schemas.sh`), luego
`openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in <archivo>.dump.enc | docker compose exec -T db sh -c 'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` y después `up -d`. Ensayar este camino completo cada trimestre.

**Pasos del operador (no automatizados, sin servicios pagos):**
- Cron diario: `0 3 * * * cd /ruta/modivara && BACKUP_PASSPHRASE=... scripts/backup.sh >> backups/cron.log 2>&1`.
- Copia fuera del VPS tras cada backup (p. ej. `rsync`/`scp` a otra máquina o un bucket que ya se tenga) y la passphrase en un gestor de contraseñas distinto del VPS.
- Monitorización: alertar si no hay un `.dump.enc` de menos de 26 h (p. ej. `find backups -name '*.enc' -mmin -1560 | grep -q .` desde un cron o monitor externo gratuito) y si `restore-check.sh` falla.

**Ensayo del 04/11/2026** (demo local, 508 KB cifrado): restaurado en `postgres:18.6` desechable, conteos origen = restaurado (cuentas 6, negocios 3, planos publicados 5, llamados 586, movimientos de stock 495, `audit_log` 76), `restore-check: OK`. Con un conteo alterado a mano el script salió con código 1; con passphrase errónea falló en el descifrado.

## 6. Salud y eventos fallidos

- `GET /api/v1/health/live` (alias `/health`): el proceso responde. Sirve para reiniciar el contenedor.
- `GET /api/v1/health/ready`: además hace `SELECT 1`; 503 si la base no responde. Sirve para sacar la instancia del balanceador.
- Los eventos del outbox que agotan sus reintentos quedan con `failed_at` y **no** ponen `ready` en 503. Se detectan en los logs de la API: `outbox.event_failed` (una vez por evento, con `event_id`, `event_type`, `organization_id`) y `outbox.failed_pending` (en cada sonda `ready` mientras queden). Alertar sobre ambos.
- Liberarlos tras corregir la causa: `docker compose exec api sh -c 'cd /repo/apps/api && node dist/outbox-retry.js <core|hospitality|commerce> [event_id]'` (en desarrollo, `pnpm outbox:retry <dominio> [event_id]`). El dominio es obligatorio: sin él, el comando solo imprime el uso y sale con código 1.

## 7. Incidentes (primeros pasos)

Siempre: `docker compose ps` y `docker compose logs --tail=200 api db`.

- **No llegan llamados al tablero.** (1) `/health/ready` ok? Si no, ver «base caída». (2) Logs de la API: `outbox.event_failed`/`outbox.failed_pending` indican eventos detenidos, corregir la causa y `outbox-retry`. (3) ¿El gateway está enviando? Mirar `device_events` y los logs del gateway; si no llegan eventos, ver «gateway caído». (4) El tablero depende del WebSocket (`/api/v1/realtime` por Caddy): recargar y comprobar la consola del navegador.
- **Gateway caído.** El gateway es un dispositivo propio: revisar alimentación y red, y que su clave siga vigente. Con MQTT, comprobar el contenedor `mqtt` y `MQTT_PASSWORD`. Los botones no reintentan por su cuenta más allá de lo que haga el gateway; los llamados perdidos mientras estuvo caído no se reconstruyen.
- **Base caída.** `docker compose ps db` y sus logs. Si es disco lleno, liberar espacio (logs, backups viejos) y `docker compose restart db`. Si el volumen está dañado: levantar `db` con volumen nuevo y restaurar el último backup (§5). La API vuelve sola cuando `ready` responde 200. Anotar la hora del último backup: es la pérdida máxima de datos.
- Tras cualquier incidente que toque datos: `scripts/restore-check.sh` sobre un backup nuevo.

## 8. Pendiente: rol migrador separado e imagen mínima (SEC-09)

Estado actual: el rol `<dominio>_app` es dueño de su esquema y lo usa tanto para migrar como para operar, así que un SQL inyectado en la API podría hacer DDL. La imagen `api` copia el workspace completo con dependencias de desarrollo. No se tocó nada (análisis).

**Plan de roles** (`infra/postgres/init-schemas.sh`), por dominio `d`:
- `d_migrator` (LOGIN, dueño del esquema `d`): solo lo usa `prisma migrate deploy`.
- `d_app` (LOGIN, sin ser dueño): `GRANT USAGE ON SCHEMA d`, y `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` + `USAGE, SELECT ON ALL SEQUENCES` del esquema. No `CREATE`, no `TRUNCATE`.
- Para que las tablas que cree el migrador futuro queden accesibles: `ALTER DEFAULT PRIVILEGES FOR ROLE d_migrator IN SCHEMA d GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO d_app;` y lo análogo para `SEQUENCES` (`USAGE, SELECT`). Sin esto cada migración nueva deja a la API sin permisos.
- Mantener `REVOKE ALL ON SCHEMA public` para ambos. Ojo con `audit_log`: si se quiere append-only, `d_app` solo `SELECT, INSERT` sobre esa tabla.
- Los volúmenes existentes no re-ejecutan `init-schemas.sh`: se necesita un script de transición (`CREATE ROLE`, `ALTER SCHEMA ... OWNER TO d_migrator`, `ALTER TABLE ... OWNER TO` de cada tabla/tipo/secuencia, y los `GRANT`). Ensayarlo con `restore-check.sh` sobre un backup real.

**URLs y variables:** nuevas `<DOM>_MIGRATOR_DB_PASSWORD` y `<DOM>_MIGRATE_DATABASE_URL` (`postgresql://d_migrator:...@db:5432/${POSTGRES_DB}?schema=d`). `<DOM>_DATABASE_URL` pasa al rol `d_app`. `api-start.sh` exporta, por dominio, `<DOM>_DATABASE_URL=$<DOM>_MIGRATE_DATABASE_URL` solo para el subshell de `migrate deploy` (cada `prisma.config.ts` lee esa variable). Mejor aún: servicio `migrate` de un solo uso en compose (`depends_on: condition: service_completed_successfully` desde `api`), de modo que el contenedor `api` en ejecución nunca tenga las credenciales del migrador.

**Por qué `pnpm deploy --prod` rompe hoy `api-start.sh`:**
1. `prisma` (CLI) es `devDependency` de cada `domains/*/api`; `--prod` no la instala y `pnpm exec prisma migrate deploy` falla.
2. `pnpm deploy` genera un directorio por paquete (`apps/api` con sus dependencias aplanadas); desaparece `/repo/domains/*/api`, así que el bucle del script no encuentra ningún paquete y no migra nada (ni falla: el `continue` lo oculta).
3. Las migraciones y `prisma.config.ts` viven en esos paquetes y `pnpm deploy` solo copia archivos publicables: habría que copiarlas explícitamente.
4. `postinstall: prisma generate` también necesita el CLI.

Camino: imagen `migrate` aparte (con `prisma` y las carpetas de migraciones, sin el código de la API) + imagen `api` con `pnpm deploy --prod` y `node dist/main.js` sin `api-start.sh`. Criterio de aceptación: en el contenedor `api`, `CREATE TABLE` / `ALTER TABLE` falla con `permission denied`.

## 9. Activación, suspensión e integraciones (PLAN-003 MOD-73, MOD-75)

Política y detalle de qué hace cada producto: `MOD-001_productos_y_modularidad.md` §5. No hay pantalla para esto: es API, solo superadmin.

### 9.1 Habilitar o suspender un módulo

```sh
JAR=$(mktemp); read -rs PASS                       # contraseña del superadmin; no queda en el historial
printf '{"slug":"labs","username":"%s","password":"%s"}' '<usuario>' "$PASS" |
  curl -sS -c "$JAR" -H 'Content-Type: application/json' --data @- "https://$DOMAIN/api/v1/auth/login" >/dev/null
curl -sS -b "$JAR" "https://$DOMAIN/api/v1/platform/organizations"            # id del negocio
curl -sS -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"enabled":true}' \
  "https://$DOMAIN/api/v1/platform/organizations/<organization_id>/modules/<hospitality|commerce|analytics>"
rm -f "$JAR"
```

- Respuesta: `{"module":"commerce","enabled":true}`. 403 si no es superadmin; 400 si el módulo no existe; 404 para el negocio de plataforma o uno inexistente.
- Suspender un módulo ya suspendido no hace nada (ni auditoría ni eventos). **Habilitar uno ya habilitado re-publica** `core.module.enabled` por cada local activo, sin nueva fila de auditoría: es la recuperación del §9.4.
- Con cambio: `core.audit_log` registra `entitlement.enabled|disabled` y el outbox de core publica un `core.module.enabled|disabled` v1 por cada local activo.

**Qué pasa con los datos**

| Módulo | Al habilitar | Al suspender |
|---|---|---|
| `commerce` | Cada local activo recibe «Principal» y los motivos sembrados, una sola vez (idempotente). | 403 `module_disabled` en sus rutas; no se borra nada. |
| `hospitality` | Nada que inicializar (sin `location_settings` valen los defaults). | 403 en sus rutas; las pulsaciones se registran como `location_inactive` sin crear llamado. Nada se borra. |
| `analytics` | Ve los hechos ya proyectados: analytics proyecta los eventos de todos los negocios aunque no tengan el módulo. | 403 en métricas; la proyección sigue llenándose. |

Reactivar devuelve los datos tal como estaban. No hay purga ni plazo de retención (pendiente).

**Verificar** (con `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`):

```sql
SELECT action, details, occurred_at FROM core.audit_log
 WHERE organization_id = '<org>' AND action LIKE 'entitlement.%' ORDER BY occurred_at;
SELECT event_type, location_id, attempts, dispatched_at, failed_at, last_error FROM core.outbox_events
 WHERE organization_id = '<org>' AND event_type LIKE 'core.module.%' ORDER BY occurred_at DESC;
-- commerce habilitado: un «Principal» por local y al menos los 10 motivos sembrados
SELECT location_id, name, is_default FROM commerce.stock_locations WHERE organization_id = '<org>';
SELECT count(*) FROM commerce.movement_reasons WHERE organization_id = '<org>';
```

`dispatched_at` debe llenarse en segundos (el poller corre cada `OUTBOX_POLL_INTERVAL_MS`, 1 s por defecto).

**Limitaciones conocidas:** el alta de negocios sigue por seed (sin endpoint; MOD-23 mínimo). Si un seed habilita un módulo en un negocio que ya tenía locales, no se emite `core.module.enabled` (`// OPEN` en `ProvisionOrganization`): usar el endpoint.

### 9.2 Integraciones opcionales: cómo se comporta el outbox

- **Sin consumidor** (p. ej. analytics no compuesto, o `core.module.disabled`): el evento se marca despachado. La fila no se borra.
- **Consumidor que falla o tarda más de 5 s:** reintento con espera de 1 s que se duplica hasta 5 min. Al 10.º fallo (≈ 8,5 min de esperas acumuladas) queda con `failed_at`. El hecho original ya está confirmado en su dominio y no se revierte.
- **Un suscriptor que falla reintenta el evento para todos** sus suscriptores; los que ya lo procesaron lo reciben de nuevo y deduplican por `event_id`. Caso conocido: con un local ya inactivo, hospitality falla ante `core.location.created` hasta `failed_at` (`// OPEN`), y commerce lo recibe repetido sin efecto.

### 9.3 Diagnóstico (MOD-73)

Lo que existe:

- Log JSON `outbox.event_failed` (una vez, al detenerse): `event_id`, `event_type`, `correlation_id`, `organization_id`, `location_id`, `attempts`, `error`. No incluye el payload; `error` es el mensaje del suscriptor (hasta 1000 caracteres, sin filtrar).
- Log de texto por cada intento fallido: `Evento <id> (<tipo>) falló (intento n): <mensaje>`.
- `GET /api/v1/health/ready` **no** devuelve conteos (la sonda es pública). Mientras haya eventos con `failed_at`, cada sonda escribe en el log `outbox.failed_pending` con el conteo por outbox (`core`, `hospitality`, `commerce`). Analytics no tiene outbox: sus fallos aparecen en el outbox del emisor.
- Columnas `attempts`, `last_error`, `next_attempt_at`, `failed_at`, `dispatched_at` en cada `<dominio>.outbox_events`.

```sh
curl -sS "https://$DOMAIN/api/v1/health/ready"                        # {"status":"ok","database":"up"} o 503
docker compose logs --since=15m api | grep -E 'outbox\.(event_failed|failed_pending)'
```

```sql
-- Retraso por producto (a mano): pendientes y el más viejo, por tipo de evento
SELECT event_type, count(*), min(occurred_at) FROM commerce.outbox_events
 WHERE dispatched_at IS NULL AND failed_at IS NULL GROUP BY 1;   -- igual con core. y hospitality.
```

**Pendiente:** métrica de retraso por producto, saber qué suscriptor falló (solo hay el mensaje; no hay estado por evento y suscriptor), tablero de correlación entre dominios y alerta automática (hoy: alertar sobre los logs, §6).

### 9.4 Recuperar

1. Corregir la causa (log `error` / `last_error`).
2. Liberar: `docker compose exec api sh -c 'cd /repo/apps/api && node dist/outbox-retry.js <core|hospitality|commerce> [event_id]'` (desarrollo: `pnpm outbox:retry <dominio> [event_id]`). Pone `failed_at = NULL, attempts = 0` y el poller lo entrega en el siguiente ciclo.
3. **Activación perdida** (se habilitó un módulo cuando el host no lo componía, p. ej. `MODIVARA_DOMAINS` sin `commerce`: el `core.module.enabled` quedó despachado sin consumidor y el local no tiene «Principal» ni motivos): con el host ya componiendo el dominio, repetir el `PUT … {"enabled":true}` del §9.1. Re-publica el evento por local activo; los consumidores son idempotentes y la auditoría no cambia. Verificar con las consultas del §9.1.
4. Si analytics no vio eventos ya despachados (corrió sin analytics o la proyección quedó mal): `docker compose exec api sh -c 'cd /repo/apps/api && node dist/analytics-rebuild.js'` (desarrollo: `pnpm analytics:rebuild`). Vacía las tablas de analytics y reprocesa todo el historial de los outbox de hospitality y commerce, de todos los negocios, en una transacción; mientras dura, la proyección en vivo espera. Imprime `leídos/aplicados/duplicados/ignorados`. Un evento inválido aborta con su `event_id`, sale con código 1 y deja la proyección anterior.
5. Ambos comandos levantan los módulos que necesitan y exigen sus URL de base (`outbox:retry`: core + el dominio; `analytics:rebuild`: core + los de `MODIVARA_DOMAINS`, que debe incluir `analytics`). `analytics:rebuild` lee solo el historial de las fuentes compuestas y, si no hay ninguna, aborta antes de vaciar. Correrlo con la misma `MODIVARA_DOMAINS` que la API: los hechos de una fuente ausente se vaciarían sin rehacerse.

**Restauración:** el backup es de la base completa (§5): restaurar revierte también entitlements y auditoría, no hay restauración por producto. Antes de una suspensión masiva o de un `analytics:rebuild` en producción, `scripts/backup.sh`; después de cualquier restauración, `scripts/restore-check.sh`.
