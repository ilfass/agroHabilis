CREATE TABLE IF NOT EXISTS alertas_horticolas (
  id BIGSERIAL PRIMARY KEY,
  usuario_ref VARCHAR(80) NOT NULL,
  producto VARCHAR(40) NOT NULL,
  condicion TEXT NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alertas_horticolas_usuario
  ON alertas_horticolas (usuario_ref, activa, creado_en DESC);
