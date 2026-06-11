-- Agregar columna cliente en la tabla de lotes para referenciar clientes por lote
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS cliente VARCHAR(150);
