#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${CURRENT_BRANCH}" != "main" ]]; then
  echo "Error: debes estar en la rama main (actual: ${CURRENT_BRANCH})."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: hay cambios sin commitear. Hace commit antes de release."
  exit 1
fi

echo "==> Sincronizando main local con origin/main"
git pull --rebase origin main

echo "==> Publicando cambios"
git push origin main

echo "==> Ejecutando deploy a VPS"
"${ROOT_DIR}/scripts/deploy-vps.sh"
