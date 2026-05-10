CREATE TABLE IF NOT EXISTS precios_normalizados (
  id BIGSERIAL PRIMARY KEY,
  producto VARCHAR(32) NOT NULL,
  mercado VARCHAR(40) NOT NULL,
  tipo_registro VARCHAR(16) NOT NULL,
  posicion VARCHAR(24),
  moneda VARCHAR(8) NOT NULL,
  precio NUMERIC(14, 4) NOT NULL,
  tipo_cambio_implicito VARCHAR(24),
  condicion VARCHAR(40),
  plaza VARCHAR(24),
  fuente VARCHAR(120),
  fecha_mercado DATE NOT NULL,
  timestamp_origen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_precios_normalizados_comp
  ON precios_normalizados (
    producto, mercado, tipo_registro, posicion, moneda,
    tipo_cambio_implicito, condicion, plaza, fecha_mercado
  );

CREATE INDEX IF NOT EXISTS idx_precios_normalizados_producto_fecha
  ON precios_normalizados (producto, fecha_mercado DESC);

CREATE INDEX IF NOT EXISTS idx_precios_normalizados_mercado_tipo_fecha
  ON precios_normalizados (mercado, tipo_registro, fecha_mercado DESC);
