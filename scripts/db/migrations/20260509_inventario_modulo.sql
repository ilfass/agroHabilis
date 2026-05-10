-- Módulo de inventario escalable: ledger (audit) + saldos derivados por tipo de ítem.

CREATE TABLE IF NOT EXISTS inventario_movimiento (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  campana_id INTEGER REFERENCES campanas_agricolas(id) ON DELETE SET NULL,
  lote_id INTEGER REFERENCES lotes(id) ON DELETE SET NULL,
  dominio VARCHAR(24) NOT NULL,
  clase VARCHAR(40) NOT NULL DEFAULT 'stock',
  efecto VARCHAR(16) NOT NULL DEFAULT 'replace',
  payload JSONB NOT NULL DEFAULT '{}',
  fecha_referencia DATE NOT NULL,
  texto_nl TEXT,
  estado VARCHAR(32) NOT NULL DEFAULT 'confirmado',
  canal VARCHAR(16),
  idempotency_key VARCHAR(128),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmado_en TIMESTAMPTZ,
  rechazado_en TIMESTAMPTZ,
  CONSTRAINT ck_inventario_mov_dom CHECK (dominio IN ('ganado', 'cultivo')),
  CONSTRAINT ck_inventario_mov_efecto CHECK (efecto IN ('replace', 'delta')),
  CONSTRAINT ck_inventario_mov_estado CHECK (
    estado IN ('pendiente_confirmacion', 'confirmado', 'rechazado', 'expirado')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_mov_idem
  ON inventario_movimiento (usuario_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND estado = 'confirmado';

CREATE INDEX IF NOT EXISTS idx_inv_mov_usuario_creado
  ON inventario_movimiento (usuario_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_inv_mov_usuario_estado
  ON inventario_movimiento (usuario_id, estado, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_inv_mov_fecha_ref
  ON inventario_movimiento (usuario_id, fecha_referencia DESC);

CREATE INDEX IF NOT EXISTS idx_inv_mov_lote
  ON inventario_movimiento (lote_id)
  WHERE lote_id IS NOT NULL;

COMMENT ON TABLE inventario_movimiento IS 'Historial append-only del inventario por productor; payload JSON discrimina ganado vs cultivo.';

CREATE TABLE IF NOT EXISTS inventario_saldo (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  campana_id INTEGER REFERENCES campanas_agricolas(id) ON DELETE SET NULL,
  lote_id INTEGER REFERENCES lotes(id) ON DELETE SET NULL,
  dominio VARCHAR(24) NOT NULL,
  item_clave VARCHAR(160) NOT NULL,
  cantidad NUMERIC(18, 4) NOT NULL,
  unidad VARCHAR(16) NOT NULL,
  etiqueta VARCHAR(200),
  ultimo_movimiento_id BIGINT REFERENCES inventario_movimiento(id) ON DELETE SET NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_inventario_saldo_dom CHECK (dominio IN ('ganado', 'cultivo'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_saldo_natural
  ON inventario_saldo (
    usuario_id,
    dominio,
    item_clave,
    (COALESCE(lote_id, -1)),
    (COALESCE(campana_id, -1))
  );

CREATE INDEX IF NOT EXISTS idx_inv_saldo_usuario_dom
  ON inventario_saldo (usuario_id, dominio);

CREATE INDEX IF NOT EXISTS idx_inv_saldo_lote
  ON inventario_saldo (usuario_id, lote_id)
  WHERE lote_id IS NOT NULL;

COMMENT ON TABLE inventario_saldo IS 'Último valor conocido por (usuario, lote opcional, dominio, clave de ítem); se actualiza al confirmar movimientos.';

