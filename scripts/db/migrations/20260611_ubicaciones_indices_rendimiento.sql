-- Add missing performance indexes for ubicaciones and inventory foreign keys
CREATE INDEX IF NOT EXISTS idx_ubicaciones_usuario_id ON ubicaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_ubicaciones_tipo ON ubicaciones(tipo);
CREATE INDEX IF NOT EXISTS idx_inventario_movimiento_ubicacion_id ON inventario_movimiento(ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_inventario_saldo_ubicacion_id ON inventario_saldo(ubicacion_id);
