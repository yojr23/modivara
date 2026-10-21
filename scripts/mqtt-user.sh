#!/usr/bin/env bash
# Crea o rota un usuario del broker MQTT (F2-11). Uso: scripts/mqtt-user.sh <usuario>
# Usuario "api" = la API (lee todo); un usuario por gateway con su id (publica solo en modivara/gw/<id>/#).
# La contraseña aleatoria se imprime UNA vez; solo queda su hash en infra/mosquitto/passwd (ignorado por git).
# Variables: MQTT_CONFIG_DIR (default infra/mosquitto), MQTT_CONTAINER (default: servicio `mqtt` de compose).
set -euo pipefail
user="${1:?uso: scripts/mqtt-user.sh <usuario>}"
[[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "usuario inválido (letras, números, . _ -)" >&2; exit 1; }

root="$(cd "$(dirname "$0")/.." && pwd)"
dir="${MQTT_CONFIG_DIR:-$root/infra/mosquitto}"
container="${MQTT_CONTAINER:-$(cd "$root" && docker compose ps -q mqtt 2>/dev/null || true)}"
# 32 caracteres alfanuméricos (sin símbolos que compliquen clientes y URLs).
password="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)"

[ -f "$dir/passwd" ] || { : >"$dir/passwd"; }   # mosquitto no arranca sin el archivo
# La contraseña viaja por entorno: `-e U -e P` sin valor copia la variable exportada, así no aparece en los argumentos de `docker` (ps del host).
export U="$user" P="$password"
cmd='mosquitto_passwd -b /mosquitto/config/passwd "$U" "$P" && chmod 0700 /mosquitto/config/passwd'
if [ -n "$container" ]; then
  docker exec -e U -e P "$container" sh -c "$cmd"
  # OPEN: recarga por SIGHUP (Mosquitto relee passwd y acl sin cortar conexiones ya abiertas); no documentado en TECH-001.
  docker kill -s HUP "$container" >/dev/null
  reloaded="broker recargado"
else
  (cd "$root" && docker compose run --rm -T -e U -e P mqtt sh -c "$cmd")
  reloaded="broker apagado: se leerá al iniciar"
fi
echo "usuario: $user"
echo "contraseña: $password   (no se vuelve a mostrar; $reloaded)"
