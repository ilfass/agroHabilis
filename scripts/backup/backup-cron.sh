#!/usr/bin/env bash
# Backup diario desde tu PC: pull del VPS + rotación de dumps viejos.
# Crontab (ajustá hora y ruta al repo), ejemplo a las 06:10:
#   10 6 * * * /home/fabian/Documentos/Agro.habilispro/scripts/backup/backup-cron.sh >>/home/fabian/Documentos/Agro.habilispro/logs/backup-cron.log 2>&1
#
# Requiere en .env del repo: BACKUP_SSH_TARGET, BACKUP_REMOTE_APP_DIR, DATABASE_URL solo no hace falta en pull.
# Opcional: NVM_DIR; si usás nvm, suele bastar con NVM_DIR en el entorno del cron o descomentá abajo.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO" || exit 1

if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR}/nvm.sh"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[backup-cron] npm no está en PATH. En crontab agregá PATH o NVM_DIR." >&2
  exit 1
fi

set +e
npm run backup:pull
rc=$?
set -euo pipefail

npm run backup:rotate || true

exit "$rc"
