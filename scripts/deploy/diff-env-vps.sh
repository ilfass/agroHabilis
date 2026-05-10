#!/usr/bin/env bash
set -euo pipefail
#
# Compara .env del VPS con el .env local (mismas variables por defecto que deploy-vps.sh).
# Uso: bash scripts/deploy/diff-env-vps.sh
#      VPS_HOST=... VPS_USER=... VPS_PATH=... bash scripts/deploy/diff-env-vps.sh
#
# diff devuelve 0 si son iguales, 1 si difieren, >1 error.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VPS_HOST="${VPS_HOST:-147.93.36.212}"
VPS_USER="${VPS_USER:-root}"
VPS_PATH="${VPS_PATH:-/var/www/agro.habilispro.com}"

LOCAL_ENV="${ROOT_DIR}/.env"
REMOTE_LABEL="vps:${VPS_PATH}/.env"
LOCAL_LABEL="local:${LOCAL_ENV}"

if [[ ! -f "${LOCAL_ENV}" ]]; then
  echo "Error: no existe ${LOCAL_ENV}" >&2
  exit 2
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Error: ssh no esta instalado." >&2
  exit 2
fi

echo "==> Diff .env (remoto vs local)"
echo "    Remoto: ${VPS_USER}@${VPS_HOST}:${VPS_PATH}/.env"
echo "    Local:  ${LOCAL_ENV}"
echo ""

REMOTE_TMP="$(mktemp)"
cleanup() { rm -f "${REMOTE_TMP}"; }
trap cleanup EXIT

set +e
ssh -o BatchMode=yes -o ConnectTimeout=15 "${VPS_USER}@${VPS_HOST}" \
  "test -f '${VPS_PATH}/.env' && cat '${VPS_PATH}/.env'" >"${REMOTE_TMP}" 2>/dev/null
SSH_EC=$?
set -e

if [[ ${SSH_EC} -ne 0 ]] || [[ ! -s "${REMOTE_TMP}" ]]; then
  echo "Aviso: no se pudo leer el .env remoto (SSH fallo, o el archivo no existe / esta vacio)."
  echo "        No hay diff que mostrar."
  exit 0
fi

diff -u "${REMOTE_TMP}" "${LOCAL_ENV}" --label "${REMOTE_LABEL}" --label "${LOCAL_LABEL}" || DIFF_EC=$?
exit "${DIFF_EC:-0}"
