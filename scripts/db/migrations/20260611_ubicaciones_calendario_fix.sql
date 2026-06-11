-- Fix remaining tables that still have lote_id instead of ubicacion_id
ALTER TABLE IF EXISTS eventos_calendario ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS animales_individuales ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS animales_eventos ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS telemetria_labores ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;


