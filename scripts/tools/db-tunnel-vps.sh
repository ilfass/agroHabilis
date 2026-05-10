#!/usr/bin/env bash
# Túnel local -> Postgres del VPS (suele escuchar solo en 127.0.0.1:5432 en el servidor).
# Uso: en una terminal dejá corriendo este script; en .env usá DATABASE_URL con host 127.0.0.1 y el mismo LOCAL_PORT.
#
#   LOCAL_PORT=15433 bash scripts/tools/db-tunnel-vps.sh
#
# Variables (opcional): VPS_HOST, VPS_USER, LOCAL_PORT (default 15433).

set -euo pipefail

LOCAL_PORT="${LOCAL_PORT:-15433}"
VPS_HOST="${VPS_HOST:-147.93.36.212}"
VPS_USER="${VPS_USER:-root}"

echo "==> Túnel ${LOCAL_PORT}:127.0.0.1:5432 en ${VPS_USER}@${VPS_HOST} (Ctrl+C para cerrar)"
exec ssh -N -o ExitOnForwardFailure=yes -L "${LOCAL_PORT}:127.0.0.1:5432" "${VPS_USER}@${VPS_HOST}"
