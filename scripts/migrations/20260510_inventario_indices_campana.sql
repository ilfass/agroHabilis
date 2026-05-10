CREATE INDEX IF NOT EXISTS idx_inv_mov_usuario_campana_creado
  ON inventario_movimiento (usuario_id, campana_id, creado_en DESC)
  WHERE campana_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inv_saldo_usuario_campana_dom
  ON inventario_saldo (usuario_id, campana_id, dominio)
  WHERE campana_id IS NOT NULL;
