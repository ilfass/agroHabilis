-- Migración: tabla de eventos de pasturas por lote
-- Permite registrar por WhatsApp: rebrote, ingreso/retiro de animales,
-- inicio de descanso, pesaje de pasto, notas de estado.

CREATE TABLE IF NOT EXISTS eventos_pastura (
  id            SERIAL PRIMARY KEY,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lote_id       INTEGER REFERENCES lotes(id) ON DELETE SET NULL,
  lote_nombre   VARCHAR(150),
  tipo          VARCHAR(50) NOT NULL,
  -- 'ingreso_animales' | 'retiro_animales' | 'inicio_descanso' | 'rebrote' | 'pesaje_pasto' | 'nota'
  cabezas       INTEGER,
  dias_descanso INTEGER,
  observacion   TEXT,
  fecha_evento  DATE NOT NULL DEFAULT CURRENT_DATE,
  creado_en     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eventos_pastura_usuario
  ON eventos_pastura(usuario_id);

CREATE INDEX IF NOT EXISTS idx_eventos_pastura_lote
  ON eventos_pastura(lote_id);

CREATE INDEX IF NOT EXISTS idx_eventos_pastura_fecha
  ON eventos_pastura(usuario_id, fecha_evento DESC);
