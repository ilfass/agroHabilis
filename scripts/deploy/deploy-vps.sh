#!/usr/bin/env bash
set -euo pipefail
#
# Variables útiles:
#   SYNC_ENV=1   Copia .env al VPS antes de migraciones y PM2 (requiere scp).
#                Antes se fusiona con el .env remoto: conserva del VPS (si no vacío)
#                DATABASE_URL, WHATSAPP_SESSION_PATH, WHATSAPP_CLIENT_ID.
#                Lista configurable: SYNC_ENV_MERGE_KEYS=CLAVE1,CLAVE2,...
#   VPS_HOST, VPS_USER, VPS_PATH, APP_NAME, HEALTH_HOST_HEADER
#
# Antes de SYNC_ENV=1 se muestra un aviso y el diff contra el .env remoto; ver scripts/deploy/diff-env-vps.sh
#
# Orden crítico en el bloque ssh remoto: rsync ya subió el código, pero el proceso viejo sigue hasta PM2.
# Siempre: setup-db.js → npm run db:migrate → verificación esquema precios → recién entonces pm2 restart.
# Así los INSERT/ON CONFLICT del recolector (fuente, actualizado_en) no corren contra un esquema viejo.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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
  --exclude ".cache" \
  --exclude ".wwebjs_auth" \
  --exclude ".wwebjs_cache" \
  --exclude ".wwebjs_auth*" \
  --exclude ".wwebjs_cache*" \
  "${ROOT_DIR}/" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"

if sync_env_enabled; then
  echo ""
  echo "**********************************************************************"
  echo "* SYNC_ENV=1: se sube .env local fusionado con claves criticas del VPS."
  echo "*"
  echo "* Del remoto se conservan (si estan definidas y no vacias):"
  echo "*   DATABASE_URL, WHATSAPP_SESSION_PATH, WHATSAPP_CLIENT_ID"
  echo "*   (override: SYNC_ENV_MERGE_KEYS=CLAVE1,CLAVE2,...)"
  echo "*"
  echo "* Revisa el diff siguiente antes de continuar (contiene secretos)."
  echo "**********************************************************************"
  echo ""
  REMOTE_ENV_TMP="$(mktemp)"
  MERGED_ENV_TMP="$(mktemp)"
  cleanup_sync_env() {
    rm -f "${REMOTE_ENV_TMP}" "${MERGED_ENV_TMP}"
  }
  trap cleanup_sync_env EXIT
  set +e
  ssh -o BatchMode=yes -o ConnectTimeout=20 "${VPS_USER}@${VPS_HOST}" \
    "test -f '${VPS_PATH}/.env' && cat '${VPS_PATH}/.env'" >"${REMOTE_ENV_TMP}" 2>/dev/null
  set -e
  node "${ROOT_DIR}/scripts/deploy/merge-env-for-vps-sync.js" \
    "${REMOTE_ENV_TMP}" "${ROOT_DIR}/.env" >"${MERGED_ENV_TMP}"
  REMOTE_ENV_CACHED="${REMOTE_ENV_TMP}" LOCAL_MERGED_PATH="${MERGED_ENV_TMP}" \
    bash "${ROOT_DIR}/scripts/deploy/diff-env-vps.sh" || true
  echo ""
  echo "==> Subiendo .env fusionado (SYNC_ENV=1) -> ${VPS_PATH}/.env"
  scp "${MERGED_ENV_TMP}" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/.env"
  trap - EXIT
  cleanup_sync_env
fi

ssh "${VPS_USER}@${VPS_HOST}" << EOF
  cd '${VPS_PATH}'
  npm ci --omit=dev
  echo '==> Validando contexto IA requerido'
  node scripts/db/validate-ai-context.js
  echo '==> Ejecutando migraciones DB (setup-db.js)'
  node scripts/db/setup-db.js
  echo '==> Ejecutando migraciones versionadas (db:migrate)'
  npm run db:migrate
  echo '==> Verificando esquema precios (UPSERT fuente / actualizado_en)'
  node scripts/db/verify-precios-upsert-schema.js
  echo '==> Verificando tabla usuario_ganaderia_perfil'
  node -e "require('dotenv').config(); const { pool, query } = require('./src/config/database'); (async () => { const r = await query(\"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='usuario_ganaderia_perfil') AS ok\"); const ok = !!r.rows?.[0]?.ok; if (!ok) { throw new Error('Falta tabla usuario_ganaderia_perfil'); } console.log('OK tabla usuario_ganaderia_perfil'); await pool.end(); })().catch(async (e) => { console.error(e.message || e); try { await pool.end(); } catch (_) {} process.exit(1); });"
  pm2 restart '${APP_NAME}' --update-env || pm2 start src/index.js --name '${APP_NAME}'
  pm2 save
EOF

echo "==> Estado PM2"
ssh "${VPS_USER}@${VPS_HOST}" "pm2 status"

echo "==> Health endpoint"
HEALTH_BACKEND_PORT="${HEALTH_BACKEND_PORT:-}"
if [[ -n "${HEALTH_BACKEND_PORT}" ]]; then
  ssh "${VPS_USER}@${VPS_HOST}" "curl -sS --max-time 10 \"http://127.0.0.1:${HEALTH_BACKEND_PORT}/\""
else
  ssh "${VPS_USER}@${VPS_HOST}" "curl -sS --max-time 10 -H 'Host: ${HEALTH_HOST_HEADER}' http://127.0.0.1/"
fi
