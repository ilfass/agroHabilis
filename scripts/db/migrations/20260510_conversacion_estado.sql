-- Resumen interactivo: estado por conversación + deduplicación de invitación diaria

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS ultima_invitacion_resumen_interactivo DATE;

CREATE TABLE IF NOT EXISTS conversacion_estado (
  id SERIAL PRIMARY KEY,
  whatsapp VARCHAR(20) NOT NULL UNIQUE,
  flujo VARCHAR(50) NOT NULL,
  paso VARCHAR(50) NOT NULL,
  contexto JSONB DEFAULT '{}'::jsonb,
  expira_en TIMESTAMPTZ NOT NULL,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversacion_whatsapp
  ON conversacion_estado(whatsapp);
