-- Agregar coordenadas lat y lng a los lotes para permitir posicionarlos en el mapa
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS lat DECIMAL(10,6);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS lng DECIMAL(10,6);
