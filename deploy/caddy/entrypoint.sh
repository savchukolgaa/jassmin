#!/bin/sh
# Starts Caddy with the owner's dashboard password (#183) as the bcrypt hash its basic_auth wants.
# STATS_PASSWORD comes from the `stats-password` deploy parameter; only its hash stays in the
# environment Caddy runs with. Without one, a random password locks the dashboard instead of
# breaking the config, so the shop itself always starts.
set -eu

password="${STATS_PASSWORD:-}"
if [ -z "$password" ]; then
  echo "entrypoint: STATS_PASSWORD is empty; the dashboard is locked until it is set" >&2
  password="$(head -c 48 /dev/urandom | base64)"
fi
STATS_PASSWORD_HASH="$(caddy hash-password --plaintext "$password")"
export STATS_PASSWORD_HASH
unset STATS_PASSWORD password

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
