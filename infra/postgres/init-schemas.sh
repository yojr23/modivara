#!/bin/sh
# Un rol por dominio, dueño solo de su esquema (ADR-001 §5, TECH-001 §9). Corre solo al crear el volumen; es idempotente
# para volver a correrlo en una base existente cuando se agrega un dominio (ver docs/OPERACION-001 §3). No cambia contraseñas.
# ponytail: el mismo rol migra y opera; separar rol de migración y rol de app si se requiere mínimo privilegio estricto.
set -eu
for d in core hospitality commerce analytics pos; do
  pass=$(printenv "$(echo "$d" | tr a-z A-Z)_DB_PASSWORD")
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -v role="${d}_app" -v schema="$d" -v pass="$pass" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'pass') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role')
\gexec
CREATE SCHEMA IF NOT EXISTS :"schema" AUTHORIZATION :"role";
REVOKE ALL ON SCHEMA public FROM :"role";
SQL
done
