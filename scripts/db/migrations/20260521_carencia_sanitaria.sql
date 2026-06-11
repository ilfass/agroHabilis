-- Agregar campos de período de carencia a la tabla de animales individuales
ALTER TABLE animales_individuales ADD COLUMN IF NOT EXISTS carencia_hasta DATE;
ALTER TABLE animales_individuales ADD COLUMN IF NOT EXISTS carencia_detalle VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_animales_individuales_carencia
  ON animales_individuales (usuario_id, carencia_hasta) WHERE carencia_hasta IS NOT NULL;
