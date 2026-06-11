-- Crear tabla de configuración de planes dinámicos y límites semanales
CREATE TABLE IF NOT EXISTS planes_config (
  plan_nombre VARCHAR(50) PRIMARY KEY,
  precio NUMERIC NOT NULL,
  limite_audios_semanal INT, -- -1 para ilimitado
  limite_fotos_semanal INT,  -- -1 para ilimitado
  limite_consultas_semanal INT, -- -1 para ilimitado
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sembrar valores por defecto iniciales de los 4 planes
INSERT INTO planes_config (plan_nombre, precio, limite_audios_semanal, limite_fotos_semanal, limite_consultas_semanal)
VALUES
  ('gratis', 0, 4, 2, 25),
  ('basico', 22000, 40, 15, 200),
  ('pro', 29000, 60, 22, 450),
  ('pro_max', 50000, -1, -1, -1)
ON CONFLICT (plan_nombre) DO NOTHING;
