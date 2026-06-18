-- Script de migración para campañas y plan de siembra

-- 1. Agregar campania a usuario_cultivos
ALTER TABLE usuario_cultivos ADD COLUMN IF NOT EXISTS campania VARCHAR(50);

-- 2. Agregar campania a ubicaciones (lotes)
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS campania VARCHAR(50);

-- 3. Crear tabla plan_siembra
CREATE TABLE IF NOT EXISTS plan_siembra (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ubicacion_id INT REFERENCES ubicaciones(id) ON DELETE CASCADE,
  cultivo VARCHAR(100),
  campania VARCHAR(50),
  variedad VARCHAR(100),
  densidad NUMERIC,
  fecha_estimada DATE,
  estado VARCHAR(50) DEFAULT 'planificado',
  creado_en TIMESTAMP DEFAULT NOW(),
  actualizado_en TIMESTAMP DEFAULT NOW()
);

-- Index para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_plan_siembra_usuario ON plan_siembra(usuario_id);
CREATE INDEX IF NOT EXISTS idx_plan_siembra_ubicacion ON plan_siembra(ubicacion_id);
