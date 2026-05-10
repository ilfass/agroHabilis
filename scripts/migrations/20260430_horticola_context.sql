ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS tipo_precio VARCHAR(20) DEFAULT 'referencia';

ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS calidad VARCHAR(40);

ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS presentacion VARCHAR(40);

ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS volumen_ingreso_nivel VARCHAR(16);

ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS volumen_ingreso_fuente VARCHAR(120);

ALTER TABLE precios
  DROP CONSTRAINT IF EXISTS chk_precios_tipo_precio;
ALTER TABLE precios
  ADD CONSTRAINT chk_precios_tipo_precio
  CHECK (
    tipo_precio IS NULL OR LOWER(tipo_precio) IN ('operacion_real', 'oferta', 'referencia')
  ) NOT VALID;

ALTER TABLE precios
  DROP CONSTRAINT IF EXISTS chk_precios_volumen_ingreso_nivel;
ALTER TABLE precios
  ADD CONSTRAINT chk_precios_volumen_ingreso_nivel
  CHECK (
    volumen_ingreso_nivel IS NULL OR LOWER(volumen_ingreso_nivel) IN ('alto', 'medio', 'bajo', 's/d')
  ) NOT VALID;
