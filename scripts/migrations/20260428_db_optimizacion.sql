CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE precios
  ALTER COLUMN mercado TYPE VARCHAR(120);

ALTER TABLE validaciones_precios
  ALTER COLUMN mercado TYPE VARCHAR(120);

ALTER TABLE mercado_snapshot_items
  ALTER COLUMN fuente TYPE VARCHAR(120);

ALTER TABLE precios_insumos
  ALTER COLUMN fuente SET DEFAULT 'desconocida';

UPDATE precios_insumos
SET fuente = 'desconocida'
WHERE fuente IS NULL OR BTRIM(fuente) = '';

ALTER TABLE precios_insumos
  DROP CONSTRAINT IF EXISTS precios_insumos_producto_fecha_key;

ALTER TABLE precios_insumos
  DROP CONSTRAINT IF EXISTS precios_insumos_producto_fuente_fecha_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_precios_insumos_producto_fuente_fecha
  ON precios_insumos (producto, fuente, fecha);

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS chk_usuarios_plan;
ALTER TABLE usuarios
  ADD CONSTRAINT chk_usuarios_plan CHECK (plan IS NULL OR LOWER(plan) IN ('gratis', 'basico', 'pro')) NOT VALID;

ALTER TABLE precios
  DROP CONSTRAINT IF EXISTS chk_precios_precio_positivo;
ALTER TABLE precios
  ADD CONSTRAINT chk_precios_precio_positivo CHECK (precio > 0) NOT VALID;

ALTER TABLE tipo_cambio
  DROP CONSTRAINT IF EXISTS chk_tipo_cambio_valor_positivo;
ALTER TABLE tipo_cambio
  ADD CONSTRAINT chk_tipo_cambio_valor_positivo CHECK (valor > 0) NOT VALID;

ALTER TABLE precios_insumos
  DROP CONSTRAINT IF EXISTS chk_precios_insumos_precio_positivo;
ALTER TABLE precios_insumos
  ADD CONSTRAINT chk_precios_insumos_precio_positivo CHECK (precio > 0) NOT VALID;

ALTER TABLE precios_hacienda
  DROP CONSTRAINT IF EXISTS chk_precios_hacienda_promedio_positivo;
ALTER TABLE precios_hacienda
  ADD CONSTRAINT chk_precios_hacienda_promedio_positivo CHECK (precio_promedio IS NULL OR precio_promedio > 0) NOT VALID;

ALTER TABLE futuros_posiciones
  DROP CONSTRAINT IF EXISTS chk_futuros_posiciones_precio_positivo;
ALTER TABLE futuros_posiciones
  ADD CONSTRAINT chk_futuros_posiciones_precio_positivo CHECK (precio_usd IS NULL OR precio_usd > 0) NOT VALID;

ALTER TABLE mercado_snapshot_items
  DROP CONSTRAINT IF EXISTS chk_snapshot_items_precio_positivo;
ALTER TABLE mercado_snapshot_items
  ADD CONSTRAINT chk_snapshot_items_precio_positivo CHECK (precio IS NULL OR precio > 0) NOT VALID;

ALTER TABLE mercado_snapshot_items
  DROP CONSTRAINT IF EXISTS chk_snapshot_items_precio_usd_positivo;
ALTER TABLE mercado_snapshot_items
  ADD CONSTRAINT chk_snapshot_items_precio_usd_positivo CHECK (precio_usd IS NULL OR precio_usd > 0) NOT VALID;

ALTER TABLE mercado_snapshot_items
  DROP CONSTRAINT IF EXISTS chk_snapshot_items_confiabilidad;
ALTER TABLE mercado_snapshot_items
  ADD CONSTRAINT chk_snapshot_items_confiabilidad CHECK (confiabilidad IS NULL OR LOWER(confiabilidad) IN ('alta', 'media', 'baja')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_snapshot_items_cat_prod_plaza
  ON mercado_snapshot_items(snapshot_id, categoria, producto, plaza);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_producto_trgm
  ON mercado_snapshot_items USING GIN (producto gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_plaza_trgm
  ON mercado_snapshot_items USING GIN (COALESCE(plaza, '') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_fuente_trgm
  ON mercado_snapshot_items USING GIN (COALESCE(fuente, '') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_categoria_lower
  ON mercado_snapshot_items (LOWER(categoria));

CREATE INDEX IF NOT EXISTS idx_precios_cultivo_fecha
  ON precios (cultivo, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_precios_mercado_fecha
  ON precios (mercado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_precios_fecha
  ON precios (fecha DESC);

CREATE INDEX IF NOT EXISTS idx_tipo_cambio_tipo_fecha
  ON tipo_cambio (tipo, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_historial_consultas_usuario_creado
  ON historial_consultas (usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_historial_consultas_whatsapp_creado
  ON historial_consultas (whatsapp, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_alertas_usuario_estado
  ON alertas (usuario_id, activa, disparada, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_precios_insumos_fecha_categoria_producto
  ON precios_insumos (fecha DESC, categoria, producto);
CREATE INDEX IF NOT EXISTS idx_precios_hacienda_fecha_categoria
  ON precios_hacienda (fecha DESC, categoria);
