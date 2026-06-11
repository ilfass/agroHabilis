-- Migración para Cola de Reintentos de Telemetría (Gemini Vision Quota Limits)
CREATE TABLE IF NOT EXISTS vision_retry_queue (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    whatsapp_norm VARCHAR(50) NOT NULL,
    media_buffer BYTEA NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    intentos INT DEFAULT 0,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ultimo_intento TIMESTAMP WITH TIME ZONE,
    error_mensaje TEXT
);

-- Índice para optimizar búsquedas por usuario
CREATE INDEX IF NOT EXISTS idx_vision_retry_usuario ON vision_retry_queue(usuario_id);
