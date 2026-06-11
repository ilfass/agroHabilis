-- Crear tabla ubicaciones
CREATE TABLE IF NOT EXISTS firmas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre VARCHAR(150) NOT NULL,
  codigo VARCHAR(10),
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE (usuario_id, nombre)
);

CREATE TABLE IF NOT EXISTS campos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  firma_id INTEGER REFERENCES firmas(id) ON DELETE SET NULL,
  nombre VARCHAR(150) NOT NULL,
  codigo VARCHAR(10),
  provincia VARCHAR(100),
  ciudad VARCHAR(120),
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE (usuario_id, nombre)
);

CREATE TABLE IF NOT EXISTS ubicaciones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  campo_id INTEGER REFERENCES campos(id) ON DELETE SET NULL,
  ubicacion_padre_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE,
  tipo VARCHAR(50) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  codigo VARCHAR(10),
  hectareas DECIMAL(10,2),
  capacidad_cabezas INTEGER,
  tipo_encierre VARCHAR(50),
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  geojson JSONB,
  cliente VARCHAR(150),
  firma VARCHAR(150),
  provincia VARCHAR(100),
  partido VARCHAR(100),
  cultivo VARCHAR(100),
  variedad VARCHAR(100),
  fecha_siembra DATE,
  densidad VARCHAR(50),
  rinde_esperado DECIMAL(10,2),
  arrendado BOOLEAN DEFAULT false,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE (usuario_id, campo_id, nombre)
);

-- Add missed columns to existing ubicaciones table if they don't exist
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS cliente VARCHAR(150);
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS firma VARCHAR(150);
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS provincia VARCHAR(100);
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS partido VARCHAR(100);
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS cultivo VARCHAR(100);
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS variedad VARCHAR(100);
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS fecha_siembra DATE;
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS densidad VARCHAR(50);
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS rinde_esperado DECIMAL(10,2);
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS arrendado BOOLEAN DEFAULT false;

-- Alter tables to drop old references and add ubicacion_id
ALTER TABLE IF EXISTS telemetria_labores DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS telemetria_labores ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS telemetria_lote_zonas DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS telemetria_lote_zonas ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS eventos_calendario DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS eventos_calendario ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS gastos DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS gastos ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS inventario_saldo DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS inventario_saldo ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS inventario_movimiento DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS inventario_movimiento ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS animales_individuales DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS animales_individuales ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS trazabilidad_aplicaciones DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS trazabilidad_aplicaciones ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

-- Drop old tables
DROP TABLE IF EXISTS corrales CASCADE;
DROP TABLE IF EXISTS feedlots CASCADE;
DROP TABLE IF EXISTS lotes CASCADE;
