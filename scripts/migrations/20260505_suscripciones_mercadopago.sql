CREATE TABLE IF NOT EXISTS suscripciones (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  whatsapp VARCHAR(24),
  plan_objetivo VARCHAR(20) NOT NULL,
  mp_preapproval_id VARCHAR(120) UNIQUE,
  mp_payer_id VARCHAR(120),
  mp_init_point TEXT,
  mp_sandbox_init_point TEXT,
  mp_status VARCHAR(40),
  mp_external_reference VARCHAR(160),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suscripciones_usuario_id ON suscripciones (usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_suscripciones_whatsapp ON suscripciones (whatsapp);
CREATE INDEX IF NOT EXISTS idx_suscripciones_status ON suscripciones (mp_status);

ALTER TABLE suscripciones
  DROP CONSTRAINT IF EXISTS chk_suscripciones_plan_objetivo;

ALTER TABLE suscripciones
  ADD CONSTRAINT chk_suscripciones_plan_objetivo
  CHECK (LOWER(plan_objetivo) IN ('basico', 'pro', 'gratis')) NOT VALID;

CREATE TABLE IF NOT EXISTS suscripciones_webhooks (
  id BIGSERIAL PRIMARY KEY,
  mp_topic VARCHAR(80),
  mp_preapproval_id VARCHAR(120),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suscripciones_webhooks_preapproval_id
  ON suscripciones_webhooks (mp_preapproval_id, creado_en DESC);
