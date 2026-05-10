# Migraciones SQL

Las migraciones versionadas viven en esta carpeta y se ejecutan con:

`npm run db:migrate`

Reglas:
- nombrar archivos con prefijo de fecha `YYYYMMDD_...`
- incluir solo SQL idempotente (con `IF EXISTS` / `IF NOT EXISTS` cuando aplique)
- no borrar migraciones ya aplicadas
