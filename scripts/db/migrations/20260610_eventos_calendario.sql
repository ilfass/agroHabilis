CREATE TABLE IF NOT EXISTS eventos_calendario (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo VARCHAR(150) NOT NULL,
  descripcion TEXT,
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_fin TIMESTAMPTZ,
  categoria VARCHAR(30) DEFAULT 'admin', -- 'admin', 'ganaderia', 'agricultura', 'clima', 'telemetria'
  lote_id INTEGER REFERENCES lotes(id) ON DELETE CASCADE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eventos_calendario_usuario ON eventos_calendario(usuario_id, fecha_inicio);
