#!/bin/sh
# Arranque del contenedor api: aplica las migraciones de cada dominio con su propia URL (<DOMINIO>_DATABASE_URL) y levanta la API.
set -eu
for pkg in /repo/domains/*/api; do
  [ -d "$pkg/src/infrastructure/prisma/migrations" ] || continue
  echo "migrate deploy: $(basename "$(dirname "$pkg")")"
  (cd "$pkg" && pnpm exec prisma migrate deploy)
done
cd /repo/apps/api
exec node dist/main.js
