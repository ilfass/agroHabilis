-- Agregar columna de tipo de siembra en la tabla de lotes (1ra, 2da, directa, convencional, etc.)
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS siembra_tipo VARCHAR(50);
