#!/usr/bin/env bash
set -euo pipefail
#
# Compara .env del VPS con el .env local (mismas variables por defecto que deploy-vps.sh).
# Uso: bash scripts/deploy/diff-env-vps.sh
#      VPS_HOST=... VPS_USER=... VPS_PATH=... bash scripts/deploy/diff-env-vps.sh
#
# Opcional (lo usa deploy-vps.sh con SYNC_ENV=1):
#   REMOTE_ENV_CACHED=/ruta/.env.remoto   Evita un segundo SSH al .env remoto.
#   LOCAL_MERGED_PATH=/ruta/.env.fusion   Diff remoto vs este archivo (preview del scp).
#
# diff devuelve 0 si son iguales, 1 si difieren, >1 error.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VPS_HOST="${VPS_HOST:-147.93.36.212}"
VPS_USER="${VPS_USER:-root}"
VPS_PATH="${VPS_PATH:-/var/www/agro.habilispro.com}"

LOCAL_ENV="${ROOT_DIR}/.env"
REMOTE_LABEL="vps:${VPS_PATH}/.env"

if [[ -n "${LOCAL_MERGED_PATH:-}" ]] && [[ ! -f "${LOCAL_MERGED_PATH}" ]]; then
  echo "Error: LOCAL_MERGED_PATH no existe: ${LOCAL_MERGED_PATH}" >&2
  exit 2
fi

if [[ -z "${LOCAL_MERGED_PATH:-}" ]] && [[ ! -f "${LOCAL_ENV}" ]]; then
  echo "Error: no existe ${LOCAL_ENV}" >&2
  exit 2
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Error: ssh no esta instalado." >&2
  exit 2
fi

RIGHT_LOCAL="${LOCAL_MERGED_PATH:-${LOCAL_ENV}}"
if [[ -n "${LOCAL_MERGED_PATH:-}" ]]; then
  LOCAL_LABEL="fusionado (sube con SYNC_ENV=1):${LOCAL_MERGED_PATH}"
else
  LOCAL_LABEL="local:${LOCAL_ENV}"
fi

echo "==> Diff .env (remoto vs ${LOCAL_LABEL})"
echo "    Remoto: ${VPS_USER}@${VPS_HOST}:${VPS_PATH}/.env"
echo "    Derecha: ${RIGHT_LOCAL}"
echo ""

REMOTE_TMP=""
CREATED_REMOTE_TMP=0
cleanup() {
  if [[ "${CREATED_REMOTE_TMP}" -eq 1 ]] && [[ -n "${REMOTE_TMP}" ]]; then
    rm -f "${REMOTE_TMP}"
  fi
}
trap cleanup EXIT

if [[ -n "${REMOTE_ENV_CACHED:-}" ]] && [[ -f "${REMOTE_ENV_CACHED}" ]]; then
  REMOTE_FILE="${REMOTE_ENV_CACHED}"
else
  REMOTE_TMP="$(mktemp)"
  CREATED_REMOTE_TMP=1
  set +e
  ssh -o BatchMode=yes -o ConnectTimeout=15 "${VPS_USER}@${VPS_HOST}" \
    "test -f '${VPS_PATH}/.env' && cat '${VPS_PATH}/.env'" >"${REMOTE_TMP}" 2>/dev/null
  SSH_EC=$?
  set -e
  REMOTE_FILE="${REMOTE_TMP}"

  if [[ ${SSH_EC} -ne 0 ]] || [[ ! -s "${REMOTE_TMP}" ]]; then
    echo "Aviso: no se pudo leer el .env remoto (SSH fallo, o el archivo no existe / esta vacio)."
    echo "        No hay diff que mostrar."
    exit 0
  fi
fi

diff -u "${REMOTE_FILE}" "${RIGHT_LOCAL}" --label "${REMOTE_LABEL}" --label "${LOCAL_LABEL}" || DIFF_EC=$?
exit "${DIFF_EC:-0}"
