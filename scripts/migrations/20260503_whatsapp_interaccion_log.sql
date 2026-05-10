CREATE TABLE IF NOT EXISTS whatsapp_interaccion_log (
  id BIGSERIAL PRIMARY KEY,
  whatsapp_norm VARCHAR(24) NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  direccion VARCHAR(3) NOT NULL CHECK (direccion IN ('in', 'out')),
  cuerpo TEXT NOT NULL,
  ruta VARCHAR(96),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_interaccion_whatsapp_creado
  ON whatsapp_interaccion_log (whatsapp_norm, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_wa_interaccion_usuario_creado
  ON whatsapp_interaccion_log (usuario_id, creado_en DESC)
  WHERE usuario_id IS NOT NULL;
