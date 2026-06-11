-- Ampliación de agricultura: Detalles de lote y tabla de monitoreo periódico.

-- 1. Agregar columnas de perfil de cultivo a la tabla de lotes
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS variedad VARCHAR(150);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS fecha_siembra DATE;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS densidad NUMERIC(12,2);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS rinde_esperado NUMERIC(12,2);

-- 2. Tabla para monitoreo periódico (el equivalente a seguimiento individual en ganadería)
CREATE TABLE IF NOT EXISTS monitoreo_agricola (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  campana_id INTEGER REFERENCES campanas_agricolas(id) ON DELETE SET NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  estado_fenologico VARCHAR(150),
  humedad_suelo VARCHAR(150),
  incidencia_sanitaria VARCHAR(150), -- malezas, plagas, enfermedades
  observaciones TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoreo_agricola_usuario_lote 
  ON monitoreo_agricola (usuario_id, lote_id);

CREATE INDEX IF NOT EXISTS idx_monitoreo_agricola_fecha
  ON monitoreo_agricola (fecha DESC);
