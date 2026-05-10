#!/usr/bin/env bash
set -euo pipefail
#
# Variables útiles:
#   SYNC_ENV=1   Copia .env local al VPS antes de migraciones y PM2 (requiere scp).
#   VPS_HOST, VPS_USER, VPS_PATH, APP_NAME, HEALTH_HOST_HEADER
#
# Antes de SYNC_ENV=1 se muestra un aviso y el diff contra el .env remoto; ver scripts/diff-env-vps.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VPS_HOST="${VPS_HOST:-147.93.36.212}"
VPS_USER="${VPS_USER:-root}"
VPS_PATH="${VPS_PATH:-/var/www/agro.habilispro.com}"
APP_NAME="${APP_NAME:-agrohabilis}"
HEALTH_HOST_HEADER="${HEALTH_HOST_HEADER:-agro.habilispro.com}"
SYNC_ENV="${SYNC_ENV:-}"

echo "==> Deploy a ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync no esta instalado."
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Error: ssh no esta instalado."
  exit 1
fi

sync_env_enabled() {
  case "${SYNC_ENV}" in 1 | true | yes | TRUE | YES) return 0 ;; *) return 1 ;; esac
}

if sync_env_enabled; then
  if ! command -v scp >/dev/null 2>&1; then
    echo "Error: SYNC_ENV=1 requiere scp."
    exit 1
  fi
  if [[ ! -f "${ROOT_DIR}/.env" ]]; then
    echo "Error: SYNC_ENV=1 pero no existe ${ROOT_DIR}/.env"
    exit 1
  fi
fi

rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".env" \
  --exclude ".cache/puppeteer" \
  --exclude ".wwebjs_auth" \
  --exclude ".wwebjs_cache" \
  --exclude ".wwebjs_auth*" \
  --exclude ".wwebjs_cache*" \
  "${ROOT_DIR}/" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"

if sync_env_enabled; then
  echo ""
  echo "**********************************************************************"
  echo "* SYNC_ENV=1: el .env del servidor se REEMPLAZA por el .env local."
  echo "*"
  echo "* WhatsApp (LocalAuth): si cambian respecto de lo que uso el bot,"
  echo "*   WHATSAPP_SESSION_PATH o WHATSAPP_CLIENT_ID, la sesion en disco"
  echo "*   deja de coincidir y WhatsApp pedira QR otra vez."
  echo "*"
  echo "* Revisa el diff siguiente antes de continuar (contiene secretos)."
  echo "**********************************************************************"
  echo ""
  bash "${ROOT_DIR}/scripts/diff-env-vps.sh" || true
  echo ""
  echo "==> Subiendo .env (SYNC_ENV=1) -> ${VPS_PATH}/.env"
  scp "${ROOT_DIR}/.env" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/.env"
fi

ssh "${VPS_USER}@${VPS_HOST}" "\
  cd '${VPS_PATH}' && \
  npm ci --omit=dev && \
  echo '==> Validando contexto IA requerido' && \
  node scripts/validate-ai-context.js && \
  echo '==> Ejecutando migraciones DB (setup-db.js)' && \
  node scripts/setup-db.js && \
  echo '==> Ejecutando migraciones versionadas (db:migrate)' && \
  npm run db:migrate && \
  echo '==> Verificando tabla usuario_ganaderia_perfil' && \
  node -e \"require('dotenv').config(); const { pool, query } = require('./src/config/database'); (async () => { const r = await query(\\\"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='usuario_ganaderia_perfil') AS ok\\\"); const ok = !!r.rows?.[0]?.ok; if (!ok) { throw new Error('Falta tabla usuario_ganaderia_perfil'); } console.log('OK tabla usuario_ganaderia_perfil'); await pool.end(); })().catch(async (e) => { console.error(e.message || e); try { await pool.end(); } catch (_) {} process.exit(1); });\" && \
  pm2 restart '${APP_NAME}' --update-env || pm2 start src/index.js --name '${APP_NAME}' && \
  pm2 save"

echo "==> Estado PM2"
ssh "${VPS_USER}@${VPS_HOST}" "pm2 status"

echo "==> Health endpoint"
HEALTH_BACKEND_PORT="${HEALTH_BACKEND_PORT:-}"
if [[ -n "${HEALTH_BACKEND_PORT}" ]]; then
  ssh "${VPS_USER}@${VPS_HOST}" "curl -sS --max-time 10 \"http://127.0.0.1:${HEALTH_BACKEND_PORT}/\""
else
  ssh "${VPS_USER}@${VPS_HOST}" "curl -sS --max-time 10 -H 'Host: ${HEALTH_HOST_HEADER}' http://127.0.0.1/"
fi
