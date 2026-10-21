#!/usr/bin/env bash
# Verifica la ACL real de Mosquitto (F2-11) con un broker desechable que usa infra/mosquitto/{mosquitto.conf,acl}
# y usuarios propios en un directorio temporal: no toca el passwd local ni el broker del compose.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
image="$(grep -A1 'mqtt:' "$root/docker-compose.yml" | grep -o 'eclipse-mosquitto:[^ ]*')"
name="modivara-acl-check-$$"
tmp="$(mktemp -d)"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
cp "$root/infra/mosquitto/mosquitto.conf" "$root/infra/mosquitto/acl" "$tmp/"
chmod 755 "$tmp"; chmod 644 "$tmp"/*
docker run -d --name "$name" -v "$tmp:/mosquitto/config" "$image" >/dev/null

pw() { MQTT_CONFIG_DIR="$tmp" MQTT_CONTAINER="$name" "$root/scripts/mqtt-user.sh" "$1" | sed -n 's/^contraseña: \([A-Za-z0-9]*\).*/\1/p'; }
# Para crear el passwd hace falta que el broker arranque: se crea vacío y se reinicia tras los alta.
: >"$tmp/passwd"; docker restart "$name" >/dev/null
api_pw="$(pw api)"; a_pw="$(pw gw-a)"; b_pw="$(pw gw-b)"
sleep 1

fail=0
ok() { echo "OK   $1"; }
ko() { echo "FALLA $1"; fail=1; }
pub() { docker exec "$name" mosquitto_pub -V 5 -q 1 -u "$1" -P "$2" -t "$3" -m "$4" 2>/dev/null || true; }

out="$tmp/sub.out"
docker exec "$name" mosquitto_sub -V 5 -u api -P "$api_pw" -t 'modivara/gw/#' -F '%t %p' -W 6 >"$out" 2>&1 &
sub=$!
sleep 1
pub gw-a "$a_pw" modivara/gw/gw-a/press a-propio
pub gw-a "$a_pw" modivara/gw/gw-b/press a-en-b
pub gw-b "$b_pw" modivara/gw/gw-b/heartbeat b-propio
pub gw-a "mala" modivara/gw/gw-a/press a-clave-mala
docker exec "$name" mosquitto_pub -V 5 -q 1 -t modivara/gw/gw-a/press -m anonimo >/dev/null 2>&1 || true
wait "$sub" || true

grep -q 'modivara/gw/gw-a/press a-propio' "$out" && ok "gw-a publica en su tópico" || ko "gw-a no pudo publicar en su tópico"
grep -q 'a-en-b' "$out" && ko "gw-a publicó en el tópico de gw-b" || ok "gw-a NO publica en el tópico de gw-b"
grep -q 'modivara/gw/gw-b/heartbeat b-propio' "$out" && ok "gw-b publica en su tópico" || ko "gw-b no pudo publicar en su tópico"
grep -q 'a-clave-mala\|anonimo' "$out" && ko "el broker aceptó credenciales inválidas o anónimo" || ok "contraseña errónea y anónimo rechazados"
[ "$(grep -c 'modivara/gw/' "$out")" -eq 2 ] && ok "api lee ambos gateways" || ko "api no leyó exactamente los mensajes de ambos gateways"
echo "--- mensajes recibidos por api:"; cat "$out"
exit "$fail"
