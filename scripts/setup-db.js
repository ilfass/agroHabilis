require("dotenv").config();
const { query, pool, testConnection } = require("../src/config/database");

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
  mercado VARCHAR(50) NOT NULL,
  precio DECIMAL(12,2) NOT NULL,
  moneda VARCHAR(5) DEFAULT 'ARS',
  fecha DATE NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(cultivo, mercado, fecha)
);

CREATE TABLE IF NOT EXISTS tipo_cambio (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  fecha DATE NOT NULL,
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
  creado_en TIMESTAMP DEFAULT NOW()
);

ALTER TABLE historial_consultas
  ADD COLUMN IF NOT EXISTS ia_sin_contexto BOOLEAN;

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
  UNIQUE(producto, fecha)
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
  mercado VARCHAR(50),
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
  fuente VARCHAR(50),
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

const setupDatabase = async () => {
  try {
    await testConnection();
    await query(createTablesSQL);
    await query(seedUsuarioSistemaSQL);
    await query(seedFletesSQL);
    console.log("Tablas creadas/verificadas correctamente.");
  } catch (error) {
    console.error("Error durante setup de base de datos:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

setupDatabase();
