-- Add ubicacion_id to eventos_pastura
ALTER TABLE IF EXISTS eventos_pastura ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;
