# Scripts

Todo lo ejecutable desde `npm run` está en `package.json`. El resto se invoca con `node scripts/<archivo>.js`.

| Área | Archivos |
|------|----------|
| Deploy / VPS | `deploy-vps.sh`, `diff-env-vps.sh`, `release-vps.sh`, `vps-install-chromium-deps.sh`, `vps-whatsapp-logs.sh` |
| Base de datos | `setup-db.js`, `migrate-db.js`, `migrations/*.sql` |
| Backups PostgreSQL | `backup-dump.js`, `backup-pull-local.js`, `backup-rotate.js`, `backup-cron.sh` |
| WhatsApp / operación | `wa-qr-terminal.js`, `ver-estado-chat-whatsapp.js`, `validate-ai-context.js` |
| Datos / backfill | `backfill-*.js` |
| QA y simulaciones | `qa-whatsapp.js`, `score-simulacion.js`, `simular-productor-papa.js`, `test-*.js`, `inventario-prueba-grano.js` |
| Análisis / export | `export-interacciones-captura.js`, `watch-historial-consultas.js`, `report-onboarding-usuarios.js`, `prueba-consultas-traza.js`, `seed-casos-reales.js` |

Los artefactos de deploy tipo capturas de `nginx -t` no se versionan: usá `.deploy-backups/` en local (ignorado por git).
