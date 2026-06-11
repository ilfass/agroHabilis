-- Migración para soportar teléfonos autorizados (Delegación de Identidad)
-- Permite agrupar números secundarios bajo una misma cuenta principal (dueño de campo)

CREATE TABLE IF NOT EXISTS telefonos_autorizados (
  id SERIAL PRIMARY KEY,
  usuario_principal_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  whatsapp_autorizado VARCHAR(20) NOT NULL UNIQUE,
  nombre_contacto VARCHAR(100) NOT NULL,
  rol VARCHAR(20) DEFAULT 'operario', -- 'encargado', 'operario'
  activo BOOLEAN DEFAULT true,
  creado_en TIMESTAMP DEFAULT NOW()
);

-- Índice de alto rendimiento para búsquedas conversacionales rápidas
CREATE INDEX IF NOT EXISTS idx_telefonos_autorizados_whatsapp 
  ON telefonos_autorizados (whatsapp_autorizado) 
  WHERE activo = true;
