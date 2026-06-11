-- Migración para Registro Rústico de Labores de Maquinaria vía Gemini Vision
CREATE TABLE IF NOT EXISTS registro_labores_maquinaria (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo_labor VARCHAR(20) CHECK (tipo_labor IN ('SIEMBRA', 'COSECHA', 'PULVERIZACION')),
    lote_nombre VARCHAR(100),
    hectareas_reales DECIMAL(10,2),
    dosis_promedio DECIMAL(12,2),
    producto_insumo VARCHAR(150),
    datos_crudos_json JSONB, -- Respaldar el JSON completo de Gemini por si se añaden campos futuros
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para optimización de consultas
CREATE INDEX IF NOT EXISTS idx_reg_maquinaria_usuario ON registro_labores_maquinaria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_reg_maquinaria_lote ON registro_labores_maquinaria(lote_nombre);
