-- Script de migración para campañas y plan de siembra

-- 1. Crear tabla de catálogos o opciones predefinidas (si no existe) para almacenar listas desplegables.
CREATE TABLE IF NOT EXISTS sistema_catalogos (
  id SERIAL PRIMARY KEY,
  categoria VARCHAR(100) NOT NULL,
  valor VARCHAR(100) NOT NULL,
  activo BOOLEAN DEFAULT true,
  orden INT DEFAULT 0
);
-- Insertar campañas iniciales
INSERT INTO sistema_catalogos (categoria, valor, orden) VALUES
('campania', '23/24', 1),
('campania', '24/25', 2),
('campania', '25/26', 3)
ON CONFLICT DO NOTHING;

-- 2. Agregar campania a usuario_cultivos
ALTER TABLE usuario_cultivos ADD COLUMN IF NOT EXISTS campania VARCHAR(50);

-- 3. Agregar campania y uso a ubicaciones (lotes)
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS campania VARCHAR(50);
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS uso VARCHAR(50);

-- 4. Crear tabla plan_siembra
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
