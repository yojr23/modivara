#!/bin/sh
# Ensayo de restauración: descifra un backup, lo restaura en un PostgreSQL desechable y compara conteos. SEC-03.
# Uso: BACKUP_PASSPHRASE=... scripts/restore-check.sh [backups/modivara-XXXX.dump.enc]   (def.: el más reciente de BACKUP_DIR)
# Sale ≠0 si algo no cuadra. RESTORE_IMAGE: misma versión mayor que la de producción (docker-compose.yml).
set -eu
: "${BACKUP_PASSPHRASE:?definir BACKUP_PASSPHRASE}"
dir=${BACKUP_DIR:-./backups}
file=${1:-$(ls -1t "$dir"/modivara-*.dump.enc | head -1)}
[ -f "$file" ] && [ -f "$file.counts" ] || { echo "restore-check: falta $file o $file.counts" >&2; exit 2; }
name=modivara-restore-test
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT INT TERM
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=restore-check "${RESTORE_IMAGE:-postgres:18.6}" >/dev/null
until docker exec "$name" pg_isready -q -U postgres -h 127.0.0.1; do sleep 1; done  # 127.0.0.1: el socket ya acepta durante el init, el TCP no
db() { docker exec -i "$name" psql -q -v ON_ERROR_STOP=1 -U postgres "$@"; }
db -d postgres -c 'CREATE DATABASE restored' -c 'CREATE ROLE modivara SUPERUSER'
for d in core hospitality commerce analytics; do db -d restored -c "CREATE ROLE ${d}_app"; done

openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" \
  | docker exec -i "$name" pg_restore -U postgres -d restored --exit-on-error --no-password

got=$(db -d restored -At <<'SQL'
SELECT 'cuentas='||count(*) FROM core.app_users;
SELECT 'negocios='||count(*) FROM core.organizations;
SELECT 'planos_publicados='||count(*) FROM hospitality.space_layouts WHERE status='published';
SELECT 'llamados='||count(*) FROM hospitality.service_calls;
SELECT 'movimientos_stock='||count(*) FROM commerce.stock_movements;
SELECT 'audit_log='||count(*) FROM core.audit_log;
SQL
)
echo "origen:"; sed 's/^/  /' "$file.counts"; echo "restaurado:"; echo "$got" | sed 's/^/  /'
if [ "$got" = "$(cat "$file.counts")" ]; then echo "restore-check: OK"; else echo "restore-check: NO CUADRA" >&2; exit 1; fi
