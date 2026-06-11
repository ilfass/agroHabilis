-- Cola ligera para consultas (u otras tareas de agente). El drenador por defecto vive en el proceso Node del bot (un solo cliente WA).
CREATE TABLE IF NOT EXISTS agent_tarea_fila (
  id BIGSERIAL PRIMARY KEY,
  tipo VARCHAR(64) NOT NULL DEFAULT 'consulta_whatsapp',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado VARCHAR(32) NOT NULL DEFAULT 'pending',
  intentos INT NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  iniciado_en TIMESTAMPTZ,
  terminado_en TIMESTAMPTZ,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_tarea_fila_estado_creado
  ON agent_tarea_fila (estado, creado_en ASC);
