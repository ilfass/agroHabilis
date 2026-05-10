CREATE TABLE IF NOT EXISTS precios_horticolas (
  id BIGSERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  mercado VARCHAR(40) NOT NULL,
  zona VARCHAR(40) NOT NULL DEFAULT 'general',
  producto VARCHAR(40) NOT NULL,
  variedad VARCHAR(60) NOT NULL DEFAULT 's/d',
  calidad VARCHAR(40) NOT NULL DEFAULT 's/d',
  tratamiento VARCHAR(30) NOT NULL DEFAULT 's/d',
  lavado BOOLEAN NOT NULL DEFAULT false,
  envase VARCHAR(40) NOT NULL DEFAULT 's/d',
  unidad VARCHAR(20) NOT NULL DEFAULT 'ARS/tn',
  precio_min NUMERIC(14,2) NOT NULL,
  precio_max NUMERIC(14,2) NOT NULL,
  precio_promedio NUMERIC(14,2) NOT NULL,
  tipo_precio VARCHAR(20) NOT NULL DEFAULT 'referencia',
  volumen_categoria VARCHAR(16) NOT NULL DEFAULT 's/d',
  origen VARCHAR(80) NOT NULL DEFAULT 's/d',
  destino VARCHAR(40) NOT NULL DEFAULT 'mercado_fresco',
  fuente VARCHAR(120) NOT NULL DEFAULT 'desconocida',
  confiabilidad NUMERIC(4,3) NOT NULL DEFAULT 0.700,
  timestamp_ingesta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE precios_horticolas
  DROP CONSTRAINT IF EXISTS chk_precios_horticolas_tipo_precio;
ALTER TABLE precios_horticolas
  ADD CONSTRAINT chk_precios_horticolas_tipo_precio
  CHECK (LOWER(tipo_precio) IN ('operacion_real', 'oferta', 'referencia')) NOT VALID;

ALTER TABLE precios_horticolas
  DROP CONSTRAINT IF EXISTS chk_precios_horticolas_volumen_categoria;
ALTER TABLE precios_horticolas
  ADD CONSTRAINT chk_precios_horticolas_volumen_categoria
  CHECK (LOWER(volumen_categoria) IN ('alto', 'medio', 'bajo', 's/d')) NOT VALID;

ALTER TABLE precios_horticolas
  DROP CONSTRAINT IF EXISTS chk_precios_horticolas_precios_validos;
ALTER TABLE precios_horticolas
  ADD CONSTRAINT chk_precios_horticolas_precios_validos
  CHECK (precio_min > 0 AND precio_max > 0 AND precio_promedio > 0 AND precio_min <= precio_max) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_precios_horticolas_categoria
  ON precios_horticolas (
    fecha, mercado, zona, producto, variedad, calidad, tratamiento, lavado, envase, tipo_precio, origen, destino
  );

CREATE INDEX IF NOT EXISTS idx_precios_horticolas_producto_fecha
  ON precios_horticolas (producto, fecha DESC);

CREATE TABLE IF NOT EXISTS ingresos_mercado_horticolas (
  id BIGSERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  mercado VARCHAR(40) NOT NULL,
  producto VARCHAR(40) NOT NULL,
  camiones INTEGER,
  toneladas_estimadas NUMERIC(14,2),
  nivel_ingreso VARCHAR(16) NOT NULL DEFAULT 's/d',
  tendencia_ingreso VARCHAR(16) NOT NULL DEFAULT 'estable',
  fuente VARCHAR(120) NOT NULL DEFAULT 'desconocida',
  timestamp_ingesta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE ingresos_mercado_horticolas
  DROP CONSTRAINT IF EXISTS chk_ingresos_horticolas_nivel;
ALTER TABLE ingresos_mercado_horticolas
  ADD CONSTRAINT chk_ingresos_horticolas_nivel
  CHECK (LOWER(nivel_ingreso) IN ('alto', 'medio', 'bajo', 's/d')) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ingresos_mercado_horticolas
  ON ingresos_mercado_horticolas (fecha, mercado, producto);

CREATE TABLE IF NOT EXISTS analisis_mercado_horticolas (
  id BIGSERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  producto VARCHAR(40) NOT NULL,
  mercado VARCHAR(40) NOT NULL,
  tendencia_precio VARCHAR(16) NOT NULL DEFAULT 'estable',
  variacion_3d NUMERIC(8,2),
  variacion_7d NUMERIC(8,2),
  estado_mercado VARCHAR(20) NOT NULL DEFAULT 'estable',
  presion_oferta VARCHAR(16) NOT NULL DEFAULT 's/d',
  dispersion VARCHAR(16) NOT NULL DEFAULT 's/d',
  outliers_detectados BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_analisis_mercado_horticolas
  ON analisis_mercado_horticolas (fecha, producto, mercado);
