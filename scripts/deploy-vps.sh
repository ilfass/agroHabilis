#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VPS_HOST="${VPS_HOST:-147.93.36.212}"
VPS_USER="${VPS_USER:-root}"
VPS_PATH="${VPS_PATH:-/var/www/agro.habilispro.com}"
APP_NAME="${APP_NAME:-agrohabilis}"
HEALTH_HOST_HEADER="${HEALTH_HOST_HEADER:-agro.habilispro.com}"

echo "==> Deploy a ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync no esta instalado."
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Error: ssh no esta instalado."
  exit 1
fi

rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".env" \
  "${ROOT_DIR}/" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"

ssh "${VPS_USER}@${VPS_HOST}" "\
  cd '${VPS_PATH}' && \
  npm ci --omit=dev && \
  pm2 restart '${APP_NAME}' --update-env || pm2 start src/index.js --name '${APP_NAME}' && \
  pm2 save"

echo "==> Estado PM2"
ssh "${VPS_USER}@${VPS_HOST}" "pm2 status"

echo "==> Health endpoint"
ssh "${VPS_USER}@${VPS_HOST}" "curl -sS --max-time 10 -H 'Host: ${HEALTH_HOST_HEADER}' http://127.0.0.1/"
