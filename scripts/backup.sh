#!/bin/sh
# Backup cifrado de la base completa (todos los esquemas) desde el contenedor `db`. SEC-03.
# Uso: BACKUP_PASSPHRASE=... scripts/backup.sh   (cron diario en el VPS; ver docs/OPERACION-001)
# BACKUP_DIR (def. ./backups) · BACKUP_RETENTION_DAYS (def. 14) · DC (def. "docker compose"; p. ej. "docker compose -p modivara")
# Los roles <dominio>_app no van en el dump: los recrea infra/postgres/init-schemas.sh en un volumen nuevo (mismas contraseñas del .env).
set -eu
: "${BACKUP_PASSPHRASE:?definir BACKUP_PASSPHRASE (guardarla fuera del VPS: sin ella el backup no se abre)}"
DC=${DC:-docker compose}
dir=${BACKUP_DIR:-./backups}
days=${BACKUP_RETENTION_DAYS:-14}
mkdir -p "$dir"
umask 077
out="$dir/modivara-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"

# Conteos de control (los compara scripts/restore-check.sh). Mismas tablas que verifica la restauración.
counts() {
  $DC exec -T db sh -c 'psql -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT 'cuentas='||count(*) FROM core.app_users;
SELECT 'negocios='||count(*) FROM core.organizations;
SELECT 'planos_publicados='||count(*) FROM hospitality.space_layouts WHERE status='published';
SELECT 'llamados='||count(*) FROM hospitality.service_calls;
SELECT 'movimientos_stock='||count(*) FROM commerce.stock_movements;
SELECT 'audit_log='||count(*) FROM core.audit_log;
SQL
}

# ponytail: sin snapshot compartido; si los conteos cambian durante el dump se repite (3 intentos). Con escritura muy alta, usar pg_dump --snapshot.
for try in 1 2 3; do
  before=$(counts)
  $DC exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -out "$out.tmp"
  [ "$before" = "$(counts)" ] && break
  [ "$try" = 3 ] && { rm -f "$out.tmp"; echo "backup: la base cambió durante el dump 3 veces" >&2; exit 1; }
done
mv "$out.tmp" "$out"
echo "$before" > "$out.counts"
echo "backup: $out ($(wc -c < "$out") bytes)"

find "$dir" -name 'modivara-*.dump.enc*' -mtime +"$days" -delete
