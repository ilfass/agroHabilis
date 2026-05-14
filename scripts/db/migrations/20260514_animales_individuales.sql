-- Tabla para seguimiento individual de animales (caravanas, estado sanitario)

CREATE TABLE IF NOT EXISTS animales_individuales (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lote_id INTEGER REFERENCES lotes(id) ON DELETE SET NULL,
  caravana VARCHAR(50),
  categoria VARCHAR(50) NOT NULL,
  estado VARCHAR(50) NOT NULL DEFAULT 'sano',
  observaciones TEXT,
  fecha_ingreso DATE NOT NULL DEFAULT CURRENT_DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_animales_individuales_usuario_lote
  ON animales_individuales (usuario_id, lote_id);

CREATE INDEX IF NOT EXISTS idx_animales_individuales_caravana
  ON animales_individuales (usuario_id, caravana) WHERE caravana IS NOT NULL;
