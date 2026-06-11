-- Agregar columnas firma, provincia, partido y tipo a la tabla de lotes para soportar filtros jerárquicos
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS firma VARCHAR(150);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS provincia VARCHAR(100);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS partido VARCHAR(120);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS tipo VARCHAR(50) DEFAULT 'lote';
