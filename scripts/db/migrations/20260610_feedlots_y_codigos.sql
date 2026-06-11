-- ==============================================================
-- Reestructuración: Feedlots + Corrales como entidades propias
-- Jerarquía: Firma → Campo → { Lotes, Feedlots → Corrales }
-- ==============================================================

-- 1. Tabla feedlots (instalación, hija de campo)
--    SIN lote shadow — el feedlot es entidad independiente
CREATE TABLE IF NOT EXISTS feedlots (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  campo_id INTEGER REFERENCES campos(id) ON DELETE SET NULL,
  nombre VARCHAR(150) NOT NULL,
  capacidad_cabezas INTEGER,
  tipo_encierre VARCHAR(50),
  provincia VARCHAR(100),
  partido VARCHAR(120),
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  geojson JSONB,
  codigo VARCHAR(10),
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE (usuario_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_feedlots_usuario ON feedlots (usuario_id);

-- Si se corrió la migración anterior con lote_id, eliminarlo
ALTER TABLE feedlots DROP COLUMN IF EXISTS lote_id;
-- Si falta cantidad_corrales (de la anterior), eliminarlo (lo calculamos dinámicamente ahora)
ALTER TABLE feedlots DROP COLUMN IF EXISTS cantidad_corrales;

-- 2. Tabla corrales (subdivisión dentro de un feedlot)
CREATE TABLE IF NOT EXISTS corrales (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  feedlot_id INTEGER NOT NULL REFERENCES feedlots(id) ON DELETE CASCADE,
  nombre VARCHAR(150) NOT NULL,
  tipo_corral VARCHAR(50) DEFAULT 'engorde',  -- engorde, enfermeria, recepcion, manga
  capacidad_cabezas INTEGER,
  codigo VARCHAR(10),
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE (feedlot_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_corrales_feedlot ON corrales (feedlot_id);
CREATE INDEX IF NOT EXISTS idx_corrales_usuario ON corrales (usuario_id);

-- 3. Códigos visibles
ALTER TABLE firmas ADD COLUMN IF NOT EXISTS codigo VARCHAR(10);
ALTER TABLE campos ADD COLUMN IF NOT EXISTS codigo VARCHAR(10);
ALTER TABLE lotes  ADD COLUMN IF NOT EXISTS codigo VARCHAR(10);

CREATE UNIQUE INDEX IF NOT EXISTS ux_firmas_usuario_codigo
  ON firmas (usuario_id, codigo) WHERE codigo IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_campos_usuario_codigo
  ON campos (usuario_id, codigo) WHERE codigo IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_lotes_usuario_codigo
  ON lotes (usuario_id, codigo) WHERE codigo IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_feedlots_usuario_codigo
  ON feedlots (usuario_id, codigo) WHERE codigo IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_corrales_usuario_codigo
  ON corrales (usuario_id, codigo) WHERE codigo IS NOT NULL;

-- 4. Agregar corral_id a tablas de inventario (nullable)
ALTER TABLE inventario_movimiento ADD COLUMN IF NOT EXISTS corral_id INTEGER REFERENCES corrales(id) ON DELETE SET NULL;
ALTER TABLE inventario_saldo      ADD COLUMN IF NOT EXISTS corral_id INTEGER REFERENCES corrales(id) ON DELETE SET NULL;

-- 5. Migrar lotes existentes con tipo='feedlot' → tabla feedlots
INSERT INTO feedlots (usuario_id, campo_id, nombre, provincia, partido, lat, lng, geojson)
SELECT l.usuario_id, l.campo_id, l.nombre, l.provincia, l.partido, l.lat, l.lng, l.geojson
FROM lotes l
WHERE l.tipo = 'feedlot'
  AND NOT EXISTS (
    SELECT 1 FROM feedlots f WHERE f.usuario_id = l.usuario_id AND f.nombre = l.nombre
  );

-- 6. Migrar lotes existentes con tipo='corral' → tabla corrales
--    Intenta asignarlos a un feedlot del mismo usuario; si no hay, crea uno implícito.
--    Paso A: crear feedlot implícito para usuarios que tienen corrales pero no feedlots
INSERT INTO feedlots (usuario_id, campo_id, nombre)
SELECT DISTINCT l.usuario_id, l.campo_id, 'Feedlot (auto)'
FROM lotes l
WHERE l.tipo = 'corral'
  AND NOT EXISTS (
    SELECT 1 FROM feedlots f WHERE f.usuario_id = l.usuario_id
  )
ON CONFLICT (usuario_id, nombre) DO NOTHING;

--    Paso B: migrar corrales al primer feedlot del usuario
INSERT INTO corrales (usuario_id, feedlot_id, nombre, capacidad_cabezas)
SELECT l.usuario_id,
       (SELECT f.id FROM feedlots f WHERE f.usuario_id = l.usuario_id ORDER BY f.id LIMIT 1),
       l.nombre,
       NULL
FROM lotes l
WHERE l.tipo = 'corral'
  AND NOT EXISTS (
    SELECT 1 FROM corrales c WHERE c.usuario_id = l.usuario_id AND c.nombre = l.nombre
  )
  AND EXISTS (
    SELECT 1 FROM feedlots f WHERE f.usuario_id = l.usuario_id
  );

-- 7. Backfill codigos para registros existentes sin codigo
-- Firmas
WITH ranked AS (
  SELECT id, usuario_id,
         'FIR-' || LPAD(ROW_NUMBER() OVER (PARTITION BY usuario_id ORDER BY id)::text, 3, '0') AS new_codigo
  FROM firmas
  WHERE codigo IS NULL
)
UPDATE firmas SET codigo = ranked.new_codigo
FROM ranked WHERE firmas.id = ranked.id;

-- Campos
WITH ranked AS (
  SELECT id, usuario_id,
         'CAM-' || LPAD(ROW_NUMBER() OVER (PARTITION BY usuario_id ORDER BY id)::text, 3, '0') AS new_codigo
  FROM campos
  WHERE codigo IS NULL
)
UPDATE campos SET codigo = ranked.new_codigo
FROM ranked WHERE campos.id = ranked.id;

-- Lotes (solo tipo lote y marcadores — feedlot/corral ya migraron)
WITH ranked AS (
  SELECT id, usuario_id,
         'LOT-' || LPAD(ROW_NUMBER() OVER (PARTITION BY usuario_id ORDER BY id)::text, 3, '0') AS new_codigo
  FROM lotes
  WHERE codigo IS NULL AND (tipo IS NULL OR tipo NOT IN ('feedlot', 'corral'))
)
UPDATE lotes SET codigo = ranked.new_codigo
FROM ranked WHERE lotes.id = ranked.id;

-- Feedlots
WITH ranked AS (
  SELECT id, usuario_id,
         'FDL-' || LPAD(ROW_NUMBER() OVER (PARTITION BY usuario_id ORDER BY id)::text, 3, '0') AS new_codigo
  FROM feedlots
  WHERE codigo IS NULL
)
UPDATE feedlots SET codigo = ranked.new_codigo
FROM ranked WHERE feedlots.id = ranked.id;

-- Corrales
WITH ranked AS (
  SELECT id, usuario_id,
         'COR-' || LPAD(ROW_NUMBER() OVER (PARTITION BY usuario_id ORDER BY id)::text, 3, '0') AS new_codigo
  FROM corrales
  WHERE codigo IS NULL
)
UPDATE corrales SET codigo = ranked.new_codigo
FROM ranked WHERE corrales.id = ranked.id;
