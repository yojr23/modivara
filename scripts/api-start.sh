#!/bin/sh
# Arranque del contenedor api: aplica las migraciones de cada dominio con su propia URL (<DOMINIO>_DATABASE_URL) y levanta la API.
# Con MODIVARA_DOMAINS (p. ej. "commerce,analytics") solo migra core y esos dominios; sin definir, todos. La lista sale del mismo
# `selectedDomains()` de la API (mismas reglas; un nombre desconocido falla aquí, antes de migrar nada).
set -eu
selected=$(cd /repo/apps/api && node -e "import('./dist/domains.js').then((m) => console.log(m.selectedDomains().join(',')))")
for pkg in /repo/domains/*/api; do
  [ -d "$pkg/src/infrastructure/prisma/migrations" ] || continue
  name=$(basename "$(dirname "$pkg")")
  case ",core,$selected," in *",$name,"*) ;; *) continue ;; esac
  echo "migrate deploy: $name"
  (cd "$pkg" && pnpm exec prisma migrate deploy)
done
cd /repo/apps/api
exec node dist/main.js
