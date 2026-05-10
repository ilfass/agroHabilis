# Migraciones SQL

Las migraciones versionadas viven en esta carpeta y se ejecutan con:

`npm run db:migrate`

Reglas:
- nombrar archivos con prefijo de fecha `YYYYMMDD_...`
- incluir solo SQL idempotente (con `IF EXISTS` / `IF NOT EXISTS` cuando aplique)
- no borrar migraciones ya aplicadas

Despliegue: en el servidor, **`node scripts/db/setup-db.js`** y/o **`npm run db:migrate`** deben completarse **antes** de reiniciar la app (PM2) si el código nuevo asume columnas o índices nuevos (p. ej. `precios.fuente` y UPSERT). El script `npm run deploy:vps` ya encadena ese orden y corre `npm run db:verify:precios-upsert` como comprobación.
