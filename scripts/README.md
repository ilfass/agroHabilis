# Scripts

Los comandos habituales están en `package.json` (`npm run`). Las rutas están agrupadas por tema.

| Carpeta | Contenido |
|---------|-----------|
| `deploy/` | `deploy-vps.sh`, `diff-env-vps.sh`, `release-vps.sh`, `vps-install-chromium-deps.sh`, `vps-whatsapp-logs.sh` |
| `db/` | `setup-db.js`, `migrate-db.js`, `validate-ai-context.js`, `migrations/*.sql` |
| `backup/` | Dump/pull/rotación PostgreSQL (`backup-dump.js`, etc.) |
| `whatsapp/` | QR en terminal y diagnóstico de estado de chat |
| `qa/` | Casos y runner `qa-whatsapp.js` |
| `tools/` | Backfills, export, simulaciones, scores, pruebas puntuales |
| *(obsoletos)* | `obsoletos/scripts-deprecated/` en la raíz del repo; ver `obsoletos/README.md` |

Los artefactos de deploy (capturas de `nginx -t`, etc.) van en `.deploy-backups/` en local (ignorado por git).
