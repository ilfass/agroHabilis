-- Agregar soporte para agricultura de precisión y fertilización avanzada en lotes
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS densidad_por_metro NUMERIC(12,2);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS distancia_surcos NUMERIC(12,2);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS fertilizante VARCHAR(150);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS fertilizante_dosis NUMERIC(12,2);
