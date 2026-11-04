# OPERACION-001 · Despliegue y recuperación

Operación de Modivara en un VPS con Docker Compose (QA-09, SEC-03). Todo lo que sigue se ejecuta desde la raíz del repo en el VPS.

## 1. Variables de entorno

Se copian de `.env.example` a `.env` (no se versiona). En producción no dejar ningún valor `cambiar-*`.

| Variable | Para qué |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Superusuario del contenedor `db`; solo crea esquemas y roles. |
| `CORE_DB_PASSWORD`, `HOSPITALITY_DB_PASSWORD`, `COMMERCE_DB_PASSWORD`, `ANALYTICS_DB_PASSWORD` | Contraseña del rol `<dominio>_app`. `docker-compose.yml` arma `<DOMINIO>_DATABASE_URL`. Se leen **solo al crear el volumen** (`infra/postgres/init-schemas.sh`): cambiarlas después exige `ALTER ROLE`. |
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
- Liberarlos tras corregir la causa: `docker compose exec api sh -c 'cd /repo/apps/api && node dist/outbox-retry.js'` (en desarrollo, `pnpm outbox:retry`).

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
