-- Precios: clave granular (fuente de ingesta) + último valor del día vía UPSERT en recolector.
-- Aplicar en Postgres antes de levantar código que hace INSERT ... ON CONFLICT (cultivo, mercado, fecha, fuente).
-- En deploy: `setup-db.js` ya incluye este esquema; esta migración mantiene al día `schema_migrations`.

ALTER TABLE precios ADD COLUMN IF NOT EXISTS fuente VARCHAR(120);
ALTER TABLE precios ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ;

UPDATE precios
SET fuente = LEFT(
  regexp_replace(lower(trim(COALESCE(mercado, ''))), '\s+', '_', 'g'),
  120
)
WHERE fuente IS NULL OR btrim(fuente) = '';

UPDATE precios SET fuente = 'legacy' WHERE btrim(COALESCE(fuente, '')) = '';

ALTER TABLE precios ALTER COLUMN fuente SET DEFAULT '';
ALTER TABLE precios ALTER COLUMN fuente SET NOT NULL;

ALTER TABLE precios DROP CONSTRAINT IF EXISTS precios_cultivo_mercado_fecha_key;

DROP INDEX IF EXISTS ux_precios_cultivo_mercado_fecha_fuente;

CREATE UNIQUE INDEX IF NOT EXISTS ux_precios_cultivo_mercado_fecha_fuente
  ON precios (cultivo, mercado, fecha, fuente);
