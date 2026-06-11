-- Hacienda Profesional: Trazabilidad individual avanzada y eventos (pesajes, sanidad, partos).

-- 1. Ampliación de la tabla de animales individuales
ALTER TABLE animales_individuales ADD COLUMN IF NOT EXISTS peso NUMERIC(10,2);
ALTER TABLE animales_individuales ADD COLUMN IF NOT EXISTS sexo VARCHAR(20); -- macho, hembra, castrado
ALTER TABLE animales_individuales ADD COLUMN IF NOT EXISTS raza VARCHAR(100);
ALTER TABLE animales_individuales ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
ALTER TABLE animales_individuales ADD COLUMN IF NOT EXISTS caravana_madre VARCHAR(50);
ALTER TABLE animales_individuales ADD COLUMN IF NOT EXISTS caravana_padre VARCHAR(50);
ALTER TABLE animales_individuales ADD COLUMN IF NOT EXISTS estado_reproductivo VARCHAR(50); -- vacia, prenada, con_cria

-- 2. Tabla de eventos para historial (línea de tiempo del animal)
CREATE TABLE IF NOT EXISTS animales_eventos (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  animal_id BIGINT NOT NULL REFERENCES animales_individuales(id) ON DELETE CASCADE,
  tipo_evento VARCHAR(50) NOT NULL, -- pesaje, sanidad, tacto, parto, movimiento, venta, muerte
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  valor_numerico NUMERIC(12,2), -- para peso, dosis, etc.
  valor_texto VARCHAR(250), -- para medicamento, resultado tacto, lote destino
  observaciones TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_animales_eventos_animal_fecha 
  ON animales_eventos (animal_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_animales_eventos_usuario_tipo
  ON animales_eventos (usuario_id, tipo_evento);

-- 3. Vista/Función para último peso (opcional, pero útil)
COMMENT ON COLUMN animales_eventos.tipo_evento IS 'Tipos: pesaje (valor_numerico=kg), sanidad (valor_texto=droga), tacto (valor_texto=resultado), movimiento (valor_texto=lote_destino)';
