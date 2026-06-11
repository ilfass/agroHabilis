-- Fix inventario tables schema for ubicaciones
ALTER TABLE IF EXISTS inventario_saldo DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS inventario_saldo ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS inventario_movimiento DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS inventario_movimiento ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;
