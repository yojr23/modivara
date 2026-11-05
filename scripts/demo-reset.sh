#!/bin/sh
# SOLO DEMO LOCAL: recrea la demo de Docker desde cero con el código de esta copia y la deja lista para los E2E y los pantallazos.
# Borra la base de la demo (docker compose down -v), levanta todo, corre los cuatro seeds dentro del contenedor api, escribe en .env
# la clave nueva del gateway de Bar Demo (el seed la imprime una sola vez) y reinicia el simulador para que dé señal, y carga los
# planos de demo. Uso: scripts/demo-reset.sh   (desde la raíz; lee SEED_PASSWORD de .env; COMPOSE_PROJECT=modivara por defecto)
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo 'Falta .env (copiar .env.example y completar las claves).' >&2; exit 1; }
SEED_PASSWORD=$(sed -n 's/^SEED_PASSWORD=//p' .env)
[ -n "$SEED_PASSWORD" ] || { echo 'Falta SEED_PASSWORD en .env.' >&2; exit 1; }
dc() { docker compose -p "${COMPOSE_PROJECT:-modivara}" "$@"; }
seed() { dc exec -T -e NODE_ENV=development -e SEED_PASSWORD="$SEED_PASSWORD" api sh -c "cd /repo/apps/api && node dist/seed-$1.js"; }

[ -f infra/mosquitto/passwd ] || { echo 'Falta infra/mosquitto/passwd: scripts/mqtt-user.sh api y su clave en MQTT_PASSWORD de .env.' >&2; exit 1; }

# `down -v` también baja db-test (perfil test, sin datos que conservar): se vuelve a levantar si estaba corriendo.
test_db=$(dc ps -q db-test)
dc down -v
dc up --build -d
# La API aplica las migraciones al arrancar: los seeds esperan a que responda.
i=0; until curl -fs http://localhost/api/v1/health/ready >/dev/null; do i=$((i + 1)); [ $i -lt 90 ] || { echo 'La API no respondió en 3 min.' >&2; exit 1; }; sleep 2; done
seed core
# La primera línea SIM_GATEWAY_KEY= es la de Bar Demo (la segunda, la de Pisos, no la usa el simulador).
key=$(seed hospitality | tee /dev/stderr | sed -n 's/^SIM_GATEWAY_KEY=\([^ ]*\).*/\1/p' | head -n 1)
[ -n "$key" ] || { echo 'El seed no imprimió la clave del gateway (¿la base no estaba vacía?).' >&2; exit 1; }
sed -i.bak "s/^SIM_GATEWAY_KEY=.*/SIM_GATEWAY_KEY=$key/" .env && rm .env.bak
dc up -d --force-recreate button-sim
seed commerce
seed history
node scripts/seed-floor-plans.mjs
[ -z "$test_db" ] || dc --profile test up -d --wait db-test
echo 'Demo recreada: http://localhost (el simulador ya usa la clave nueva).'
