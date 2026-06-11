-- Migración para Telemetría Agrícola de Nube a Nube (Leaf Agriculture, John Deere, Climate FieldView, etc.)

-- 1. Tabla de Conexiones OAuth
CREATE TABLE IF NOT EXISTS telemetria_conexiones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proveedor VARCHAR(50) NOT NULL,
  leaf_user_id VARCHAR(100) UNIQUE NOT NULL,
  estado VARCHAR(20) DEFAULT 'activo',
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(usuario_id, proveedor)
);

-- 2. Tabla de Labores Consolidadas
CREATE TABLE IF NOT EXISTS telemetria_labores (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  campana_id INTEGER REFERENCES campanas_agricolas(id) ON DELETE SET NULL,
  tipo_labor VARCHAR(30) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  hectareas_reales DECIMAL(10,2) NOT NULL,
  velocidad_promedio DECIMAL(5,2),
  insumo_nombre VARCHAR(120),
  dosis_promedio DECIMAL(12,4) NOT NULL,
  unidad_dosis VARCHAR(24) NOT NULL,
  marca_maquinaria VARCHAR(50),
  modelo_maquinaria VARCHAR(80),
  externo_job_id VARCHAR(120) UNIQUE,
  payload_adicional JSONB DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de consulta frecuente para el Agente
CREATE INDEX IF NOT EXISTS idx_telemetria_labores_lote_fecha 
  ON telemetria_labores (lote_id, fecha_fin DESC);
CREATE INDEX IF NOT EXISTS idx_telemetria_labores_tipo 
  ON telemetria_labores (usuario_id, tipo_labor);

-- 3. Tabla de Zonas de Rinde y Productividad
CREATE TABLE IF NOT EXISTS telemetria_lote_zonas (
  id SERIAL PRIMARY KEY,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  campana_id INTEGER REFERENCES campanas_agricolas(id) ON DELETE CASCADE,
  zona_etiqueta VARCHAR(50) NOT NULL,
  porcentaje_area DECIMAL(5,4) NOT NULL,
  hectareas_zona DECIMAL(10,2) NOT NULL,
  rinde_historico DECIMAL(10,2),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lote_id, campana_id, zona_etiqueta)
);

CREATE INDEX IF NOT EXISTS idx_telemetria_lote_zonas_lote 
  ON telemetria_lote_zonas (lote_id);
