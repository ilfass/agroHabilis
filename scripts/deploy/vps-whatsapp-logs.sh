#!/usr/bin/env bash
# Abre los logs de PM2 en la VPS donde whatsapp-web.js imprime el QR (mismas vars que deploy-vps.sh).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
[[ -f "${ROOT_DIR}/.env.deploy" ]] && set -a && source "${ROOT_DIR}/.env.deploy" && set +a

VPS_HOST="${VPS_HOST:-147.93.36.212}"
VPS_USER="${VPS_USER:-root}"
APP_NAME="${APP_NAME:-agrohabilis}"
MODE="${1:-follow}"

if [[ "${MODE}" == "snap" ]]; then
  echo "==> Últimas líneas de salida (incluye QR si hubo reconexión reciente)"
  ssh "${VPS_USER}@${VPS_HOST}" "pm2 logs '${APP_NAME}' --lines 400 --nostream 2>&1 | tail -n 250"
else
  echo "==> Logs en vivo (${VPS_USER}@${VPS_HOST} / ${APP_NAME}). Ctrl+C para salir."
  echo "    Para un volcado puntual: $0 snap"
  ssh -t "${VPS_USER}@${VPS_HOST}" "pm2 logs '${APP_NAME}'"
fi
