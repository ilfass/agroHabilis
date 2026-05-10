-- Panel / dashboard agrupa futuros del día por fuente (MATBA API vs fallback web, etc.)
ALTER TABLE futuros_posiciones
  ADD COLUMN IF NOT EXISTS fuente VARCHAR(80) NOT NULL DEFAULT 'matba_rofex';

UPDATE futuros_posiciones
SET fuente = 'matba_rofex'
WHERE fuente IS NULL OR BTRIM(fuente) = '';
