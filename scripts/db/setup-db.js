require("dotenv").config();
const { query, pool, testConnection } = require("../../src/config/database");

const createTablesSQL = `
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE,
  whatsapp VARCHAR(20) NOT NULL UNIQUE,
  provincia VARCHAR(50),
  partido VARCHAR(50),
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  plan VARCHAR(20) DEFAULT 'gratis',
  plan_activo_hasta TIMESTAMP,
  mp_suscripcion_id VARCHAR(100),
  mp_payer_id VARCHAR(100),
  activo BOOLEAN DEFAULT true,
  creado_en TIMESTAMP DEFAULT NOW()
);

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS tipo_comercializacion VARCHAR(30) DEFAULT 'disponible';

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS whatsapp_jid VARCHAR(64);

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS whatsapp_real VARCHAR(20);

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS noticias_cantidad_pref INTEGER;

CREATE TABLE IF NOT EXISTS usuario_cultivos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  cultivo VARCHAR(50) NOT NULL,
  hectareas DECIMAL(10,2),
  costo_por_ha DECIMAL(10,2),
  activo BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS precios (
  id SERIAL PRIMARY KEY,
  cultivo VARCHAR(50) NOT NULL,
  mercado VARCHAR(120) NOT NULL,
  precio DECIMAL(12,2) NOT NULL,
  moneda VARCHAR(5) DEFAULT 'ARS',
  tipo_precio VARCHAR(20) DEFAULT 'referencia',
  calidad VARCHAR(40),
  presentacion VARCHAR(40),
  volumen_ingreso_nivel VARCHAR(16),
  volumen_ingreso_fuente VARCHAR(120),
  fecha DATE NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(cultivo, mercado, fecha)
);

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

CREATE TABLE IF NOT EXISTS alertas_horticolas (
  id BIGSERIAL PRIMARY KEY,
  usuario_ref VARCHAR(80) NOT NULL,
  producto VARCHAR(40) NOT NULL,
  condicion TEXT NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tipo_cambio (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  compra DECIMAL(10,2),
  fecha DATE NOT NULL,
  fuente VARCHAR(40),
  UNIQUE(tipo, fecha)
);

CREATE TABLE IF NOT EXISTS clima (
  id SERIAL PRIMARY KEY,
  lat DECIMAL(9,6) NOT NULL,
  lng DECIMAL(9,6) NOT NULL,
  fecha DATE NOT NULL,
  temp_min DECIMAL(5,2),
  temp_max DECIMAL(5,2),
  precipitacion DECIMAL(6,2),
  helada BOOLEAN DEFAULT false,
  descripcion TEXT,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(lat, lng, fecha)
);

CREATE TABLE IF NOT EXISTS resumenes (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  tipo VARCHAR(30) DEFAULT 'diario',
  contenido TEXT NOT NULL,
  enviado_wp BOOLEAN DEFAULT false,
  enviado_en TIMESTAMP,
  tokens_usados INTEGER,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(usuario_id, fecha, tipo)
);

ALTER TABLE resumenes
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) DEFAULT 'diario';

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'resumenes'
      AND con.contype = 'u'
      AND con.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'usuario_id' AND NOT attisdropped),
        (SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'fecha' AND NOT attisdropped)
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE resumenes DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_resumenes_usuario_fecha_tipo
  ON resumenes (usuario_id, fecha, tipo);

CREATE TABLE IF NOT EXISTS envios_whatsapp (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  resumen_id INTEGER REFERENCES resumenes(id),
  estado VARCHAR(20),
  error_msg TEXT,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS historial_consultas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  whatsapp VARCHAR(20),
  pregunta TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  tokens_usados INTEGER,
  ia_sin_contexto BOOLEAN,
  ia_provider VARCHAR(40),
  ia_provider_trace JSONB,
  creado_en TIMESTAMP DEFAULT NOW()
);

ALTER TABLE historial_consultas
  ADD COLUMN IF NOT EXISTS ia_sin_contexto BOOLEAN;

ALTER TABLE historial_consultas
  ADD COLUMN IF NOT EXISTS ia_provider VARCHAR(40);

ALTER TABLE historial_consultas
  ADD COLUMN IF NOT EXISTS ia_provider_trace JSONB;

CREATE TABLE IF NOT EXISTS whatsapp_interaccion_log (
  id BIGSERIAL PRIMARY KEY,
  whatsapp_norm VARCHAR(24) NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  direccion VARCHAR(3) NOT NULL CHECK (direccion IN ('in', 'out')),
  cuerpo TEXT NOT NULL,
  ruta VARCHAR(96),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_bot_control (
  whatsapp VARCHAR(20) PRIMARY KEY,
  bot_activo BOOLEAN DEFAULT true,
  actualizado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_estado (
  id SERIAL PRIMARY KEY,
  whatsapp VARCHAR(20) NOT NULL UNIQUE,
  paso_actual INTEGER DEFAULT 1,
  datos_temporales JSONB DEFAULT '{}'::jsonb,
  completado BOOLEAN DEFAULT false,
  creado_en TIMESTAMP DEFAULT NOW(),
  actualizado_en TIMESTAMP DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS cliente_auth_credentials (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  telefono_norm VARCHAR(24) NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  password_temporal_expires_at TIMESTAMPTZ,
  ultimo_password_cambio_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cliente_auth_credentials_telefono
  ON cliente_auth_credentials (telefono_norm);

CREATE TABLE IF NOT EXISTS cliente_auth_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_token_hash VARCHAR(128) NOT NULL UNIQUE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ip VARCHAR(64),
  user_agent TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revocada_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cliente_auth_sessions_usuario
  ON cliente_auth_sessions (usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_cliente_auth_sessions_exp
  ON cliente_auth_sessions (expires_at)
  WHERE revocada_en IS NULL;

CREATE TABLE IF NOT EXISTS usuario_zonas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  provincia VARCHAR(100) NOT NULL,
  partido VARCHAR(120) NOT NULL,
  lat DECIMAL(10,6),
  lng DECIMAL(10,6),
  prioridad SMALLINT DEFAULT 1,
  activa BOOLEAN DEFAULT true,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE (usuario_id, provincia, partido)
);

CREATE TABLE IF NOT EXISTS alertas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  cultivo VARCHAR(50) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  valor_objetivo DECIMAL(12,2) NOT NULL,
  activa BOOLEAN DEFAULT true,
  disparada BOOLEAN DEFAULT false,
  disparada_en TIMESTAMP,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS perfil_productivo (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL,
  activo BOOLEAN DEFAULT true,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campanas_agricolas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre VARCHAR(100),
  fecha_inicio DATE,
  fecha_fin DATE,
  activa BOOLEAN DEFAULT true,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lotes (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  campana_id INTEGER REFERENCES campanas_agricolas(id),
  nombre VARCHAR(100),
  hectareas DECIMAL(10,2),
  cultivo VARCHAR(50),
  arrendado BOOLEAN DEFAULT false,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_ganadero (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  categoria VARCHAR(50),
  cantidad INTEGER,
  fecha DATE NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuario_ganaderia_perfil (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  especie VARCHAR(30) NOT NULL,
  categoria VARCHAR(60) NOT NULL,
  cantidad_estimada INTEGER,
  activo BOOLEAN DEFAULT true,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE (usuario_id, especie, categoria)
);

CREATE TABLE IF NOT EXISTS gastos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  perfil VARCHAR(20) NOT NULL,
  categoria VARCHAR(50),
  descripcion TEXT,
  monto DECIMAL(12,2) NOT NULL,
  moneda VARCHAR(5) DEFAULT 'ARS',
  fecha DATE NOT NULL,
  lote_id INTEGER REFERENCES lotes(id),
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ventas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  perfil VARCHAR(20) NOT NULL,
  producto VARCHAR(50),
  cantidad DECIMAL(12,2),
  unidad VARCHAR(20),
  precio_unitario DECIMAL(12,2),
  monto_total DECIMAL(12,2),
  moneda VARCHAR(5) DEFAULT 'ARS',
  fecha DATE NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS precios_insumos (
  id SERIAL PRIMARY KEY,
  categoria VARCHAR(50) NOT NULL,
  producto VARCHAR(100) NOT NULL,
  precio DECIMAL(12,2) NOT NULL,
  unidad VARCHAR(20),
  moneda VARCHAR(5) DEFAULT 'ARS',
  fuente VARCHAR(100),
  fecha DATE NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(producto, fuente, fecha)
);

CREATE TABLE IF NOT EXISTS precios_hacienda (
  id SERIAL PRIMARY KEY,
  categoria VARCHAR(50) NOT NULL,
  precio_promedio DECIMAL(10,2),
  precio_max DECIMAL(10,2),
  precio_min DECIMAL(10,2),
  unidad VARCHAR(10) DEFAULT 'kg',
  fecha DATE NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(categoria, fecha)
);

CREATE TABLE IF NOT EXISTS futuros_posiciones (
  id SERIAL PRIMARY KEY,
  cultivo VARCHAR(50) NOT NULL,
  posicion VARCHAR(20) NOT NULL,
  precio_usd DECIMAL(10,2),
  variacion DECIMAL(8,2),
  volumen INTEGER,
  fecha DATE NOT NULL,
  fuente VARCHAR(80) NOT NULL DEFAULT 'matba_rofex',
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(cultivo, posicion, fecha)
);

CREATE TABLE IF NOT EXISTS fuentes_estado (
  id SERIAL PRIMARY KEY,
  fuente_id VARCHAR(50) NOT NULL,
  nombre VARCHAR(100),
  status VARCHAR(10),
  tiempo_ms INTEGER,
  error_msg TEXT,
  verificado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS noticias_agro (
  id SERIAL PRIMARY KEY,
  fuente VARCHAR(100) NOT NULL,
  categoria VARCHAR(50),
  titulo TEXT NOT NULL,
  url TEXT NOT NULL,
  resumen TEXT,
  publicado_en TIMESTAMP,
  tipo VARCHAR(20) DEFAULT 'noticia',
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(fuente, url)
);

CREATE TABLE IF NOT EXISTS validaciones_precios (
  id SERIAL PRIMARY KEY,
  cultivo VARCHAR(50),
  mercado VARCHAR(120),
  moneda VARCHAR(5),
  fecha DATE,
  valor DECIMAL(14,4),
  ok BOOLEAN DEFAULT false,
  score_confianza DECIMAL(5,2),
  motivo VARCHAR(120),
  referencia_valor DECIMAL(14,4),
  desvio_pct DECIMAL(8,4),
  perfil VARCHAR(20) DEFAULT 'general',
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mercado_snapshot (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  fuentes_ok TEXT[],
  fuentes_error TEXT[],
  total_items INTEGER,
  datos_completos BOOLEAN DEFAULT false,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(fecha, hora)
);

CREATE TABLE IF NOT EXISTS mercado_snapshot_items (
  id SERIAL PRIMARY KEY,
  snapshot_id INTEGER REFERENCES mercado_snapshot(id) ON DELETE CASCADE,
  categoria VARCHAR(50) NOT NULL,
  subcategoria VARCHAR(50),
  producto VARCHAR(100) NOT NULL,
  plaza VARCHAR(100),
  region VARCHAR(50),
  precio DECIMAL(14,2),
  precio_usd DECIMAL(10,2),
  precio_min DECIMAL(14,2),
  precio_max DECIMAL(14,2),
  moneda VARCHAR(5) DEFAULT 'ARS',
  unidad VARCHAR(30),
  variacion_monto DECIMAL(12,2),
  variacion_pct DECIMAL(6,3),
  posicion VARCHAR(10),
  dias_al_vencimiento INTEGER,
  distancia_km INTEGER,
  destino VARCHAR(100),
  fuente VARCHAR(120),
  url_fuente TEXT,
  confiabilidad VARCHAR(10),
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_items_snapshot
  ON mercado_snapshot_items(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_categoria
  ON mercado_snapshot_items(categoria, subcategoria, producto);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_region
  ON mercado_snapshot_items(region);

CREATE TABLE IF NOT EXISTS fletes_referencia (
  id SERIAL PRIMARY KEY,
  origen_nombre VARCHAR(100) NOT NULL,
  origen_provincia VARCHAR(50),
  origen_region VARCHAR(50),
  origen_lat DECIMAL(9,6),
  origen_lng DECIMAL(9,6),
  destino_nombre VARCHAR(100) NOT NULL,
  destino_tipo VARCHAR(30),
  destino_lat DECIMAL(9,6),
  destino_lng DECIMAL(9,6),
  distancia_km INTEGER NOT NULL,
  ruta_referencia VARCHAR(100),
  tiene_peajes BOOLEAN DEFAULT false,
  costo_peajes_ars DECIMAL(10,2),
  tipo_carga VARCHAR(30),
  activa BOOLEAN DEFAULT true,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(origen_nombre, destino_nombre, tipo_carga)
);

CREATE TABLE IF NOT EXISTS fletes_tarifas (
  id SERIAL PRIMARY KEY,
  tipo_carga VARCHAR(30) NOT NULL,
  tipo_camion VARCHAR(30),
  capacidad_tn DECIMAL(6,2),
  tarifa_usd_km_tn DECIMAL(8,5),
  tarifa_ars_km_tn DECIMAL(10,2),
  gasoil_base_ars DECIMAL(8,2),
  porcentaje_gasoil_en_costo DECIMAL(5,2) DEFAULT 35.00,
  fecha DATE NOT NULL,
  fuente VARCHAR(100),
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(tipo_carga, tipo_camion, fecha)
);

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

ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS tipo_precio VARCHAR(20) DEFAULT 'referencia';
ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS calidad VARCHAR(40);
ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS presentacion VARCHAR(40);
ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS volumen_ingreso_nivel VARCHAR(16);
ALTER TABLE precios
  ADD COLUMN IF NOT EXISTS volumen_ingreso_fuente VARCHAR(120);

ALTER TABLE precios
  DROP CONSTRAINT IF EXISTS chk_precios_tipo_precio;
ALTER TABLE precios
  ADD CONSTRAINT chk_precios_tipo_precio
  CHECK (
    tipo_precio IS NULL OR LOWER(tipo_precio) IN ('operacion_real', 'oferta', 'referencia')
  ) NOT VALID;

ALTER TABLE precios
  DROP CONSTRAINT IF EXISTS chk_precios_volumen_ingreso_nivel;
ALTER TABLE precios
  ADD CONSTRAINT chk_precios_volumen_ingreso_nivel
  CHECK (
    volumen_ingreso_nivel IS NULL OR LOWER(volumen_ingreso_nivel) IN ('alto', 'medio', 'bajo', 's/d')
  ) NOT VALID;

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

CREATE UNIQUE INDEX IF NOT EXISTS ux_precios_horticolas_categoria
  ON precios_horticolas (
    fecha, mercado, zona, producto, variedad, calidad, tratamiento, lavado, envase, tipo_precio, origen, destino
  );
CREATE INDEX IF NOT EXISTS idx_precios_horticolas_producto_fecha
  ON precios_horticolas (producto, fecha DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ingresos_mercado_horticolas
  ON ingresos_mercado_horticolas (fecha, mercado, producto);
CREATE UNIQUE INDEX IF NOT EXISTS ux_analisis_mercado_horticolas
  ON analisis_mercado_horticolas (fecha, producto, mercado);
CREATE INDEX IF NOT EXISTS idx_alertas_horticolas_usuario
  ON alertas_horticolas (usuario_ref, activa, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_tipo_cambio_tipo_fecha
  ON tipo_cambio (tipo, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_historial_consultas_usuario_creado
  ON historial_consultas (usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_historial_consultas_whatsapp_creado
  ON historial_consultas (whatsapp, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_wa_interaccion_whatsapp_creado
  ON whatsapp_interaccion_log (whatsapp_norm, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_wa_interaccion_usuario_creado
  ON whatsapp_interaccion_log (usuario_id, creado_en DESC)
  WHERE usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alertas_usuario_estado
  ON alertas (usuario_id, activa, disparada, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_precios_insumos_fecha_categoria_producto
  ON precios_insumos (fecha DESC, categoria, producto);
CREATE INDEX IF NOT EXISTS idx_precios_hacienda_fecha_categoria
  ON precios_hacienda (fecha DESC, categoria);
`;

const seedUsuarioSistemaSQL = `
INSERT INTO usuarios (nombre, whatsapp)
VALUES ('Resumen sistema', 'ahbl:sistema')
ON CONFLICT (whatsapp) DO NOTHING;
`;

const seedFletesSQL = `
INSERT INTO fletes_referencia
(origen_nombre, origen_provincia, origen_region, destino_nombre, destino_tipo, distancia_km, tipo_carga, tiene_peajes, costo_peajes_ars)
VALUES
('Pergamino', 'Buenos Aires', 'pampeana', 'Puerto Rosario', 'puerto', 220, 'granos', true, 5500),
('Junin', 'Buenos Aires', 'pampeana', 'Puerto Rosario', 'puerto', 260, 'granos', true, 6200),
('Tandil', 'Buenos Aires', 'pampeana', 'Puerto Rosario', 'puerto', 340, 'granos', true, 8500),
('Tandil', 'Buenos Aires', 'pampeana', 'Puerto Bahia Blanca', 'puerto', 340, 'granos', true, 8000),
('Rio Cuarto', 'Cordoba', 'pampeana', 'Puerto Rosario', 'puerto', 350, 'granos', true, 9000),
('Parana', 'Entre Rios', 'pampeana', 'Puerto Rosario', 'puerto', 180, 'granos', true, 4500),
('Santa Rosa', 'La Pampa', 'pampeana', 'Puerto Bahia Blanca', 'puerto', 320, 'granos', true, 7600),
('Mendoza', 'Mendoza', 'cuyo', 'Mercado Central BA', 'mercado', 1040, 'fruta', true, 12000),
('Corrientes', 'Corrientes', 'nea', 'Mercado Liniers', 'frigorifico', 1000, 'hacienda', true, 11000),
('Cordoba', 'Cordoba', 'pampeana', 'Mercado Liniers', 'frigorifico', 700, 'hacienda', true, 8500)
ON CONFLICT (origen_nombre, destino_nombre, tipo_carga) DO NOTHING;

INSERT INTO fletes_tarifas
(tipo_carga, tipo_camion, capacidad_tn, tarifa_usd_km_tn, tarifa_ars_km_tn, gasoil_base_ars, fecha, fuente)
VALUES
('granos', 'semirremolque', 28, 0.065, 91, 1050, CURRENT_DATE, 'estimacion_propia'),
('granos', 'acoplado', 22, 0.075, 105, 1050, CURRENT_DATE, 'estimacion_propia'),
('hacienda', 'semirremolque', 20, 0.085, 119, 1050, CURRENT_DATE, 'estimacion_propia'),
('fruta', 'semirremolque', 22, 0.095, 133, 1050, CURRENT_DATE, 'estimacion_propia')
ON CONFLICT (tipo_carga, tipo_camion, fecha) DO NOTHING;
`;

const seedFallbackMercadosSQL = `
WITH base AS (
  SELECT CURRENT_DATE::date AS fecha
)
INSERT INTO precios (cultivo, mercado, precio, moneda, fecha)
SELECT t.cultivo, t.mercado, t.precio, t.moneda, b.fecha
FROM base b
CROSS JOIN (
  VALUES
    ('soja', 'bcr_gix_seed', 315000::numeric, 'ARS'),
    ('maiz', 'bcr_gix_seed', 228000::numeric, 'ARS'),
    ('trigo', 'bcr_gix_seed', 242000::numeric, 'ARS'),
    ('soja', 'LNCAMPO_WEB_SEED', 312500::numeric, 'ARS'),
    ('maiz', 'LNCAMPO_WEB_SEED', 225500::numeric, 'ARS'),
    ('trigo', 'LNCAMPO_WEB_SEED', 240200::numeric, 'ARS')
) AS t(cultivo, mercado, precio, moneda)
WHERE NOT EXISTS (
  SELECT 1 FROM precios p
  WHERE p.fecha = b.fecha
    AND (
      p.mercado ILIKE 'bcr_gix%'
      OR p.mercado ILIKE 'LNCAMPO_WEB%'
    )
)
ON CONFLICT (cultivo, mercado, fecha) DO NOTHING;
`;

const setupDatabase = async () => {
  try {
    await testConnection();
    await query(createTablesSQL);
    await query(seedUsuarioSistemaSQL);
    await query(seedFletesSQL);
    await query(seedFallbackMercadosSQL);
    console.log("Tablas creadas/verificadas correctamente.");
  } catch (error) {
    console.error("Error durante setup de base de datos:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

setupDatabase();
