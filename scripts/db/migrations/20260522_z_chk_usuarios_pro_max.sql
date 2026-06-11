-- Actualizar la constraint chk_usuarios_plan para incluir 'pro_max'
ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS chk_usuarios_plan;

ALTER TABLE usuarios
  ADD CONSTRAINT chk_usuarios_plan CHECK (plan IS NULL OR LOWER(plan) IN ('gratis', 'basico', 'pro', 'pro_max')) NOT VALID;

-- Actualizar la constraint chk_suscripciones_plan_objetivo para incluir 'pro_max'
ALTER TABLE suscripciones
  DROP CONSTRAINT IF EXISTS chk_suscripciones_plan_objetivo;

ALTER TABLE suscripciones
  ADD CONSTRAINT chk_suscripciones_plan_objetivo
  CHECK (LOWER(plan_objetivo) IN ('basico', 'pro', 'gratis', 'pro_max')) NOT VALID;
