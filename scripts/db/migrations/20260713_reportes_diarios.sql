-- Create reportes_diarios table
CREATE TABLE IF NOT EXISTS reportes_diarios (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    texto_original TEXT NOT NULL,
    texto_mejorado TEXT NOT NULL,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_reportes_diarios_usuario ON reportes_diarios(usuario_id, creado_en DESC);
