#!/bin/sh
# Un rol por dominio, dueño solo de su esquema (ADR-001 §5, TECH-001 §9). Corre una vez, al crear el volumen.
# ponytail: el mismo rol migra y opera; separar rol de migración y rol de app si se requiere mínimo privilegio estricto.
set -eu
for d in core hospitality commerce analytics; do
  pass=$(printenv "$(echo "$d" | tr a-z A-Z)_DB_PASSWORD")
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -v role="${d}_app" -v schema="$d" -v pass="$pass" <<'SQL'
CREATE ROLE :"role" LOGIN PASSWORD :'pass';
CREATE SCHEMA :"schema" AUTHORIZATION :"role";
REVOKE ALL ON SCHEMA public FROM :"role";
SQL
done
