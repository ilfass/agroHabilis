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
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE (usuario_id, campo_id, nombre)
);

-- Alter tables to drop old references and add ubicacion_id
ALTER TABLE IF EXISTS telemetria_labores DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS telemetria_labores ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS telemetria_lote_zonas DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS telemetria_lote_zonas ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS eventos_calendario DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS eventos_calendario ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS gastos DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS gastos ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS saldos_inventario DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS saldos_inventario ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS movimientos_inventario DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS movimientos_inventario ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS animales_individuales DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS animales_individuales ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS trazabilidad_aplicaciones DROP COLUMN IF EXISTS lote_id CASCADE;
ALTER TABLE IF EXISTS trazabilidad_aplicaciones ADD COLUMN IF NOT EXISTS ubicacion_id INTEGER REFERENCES ubicaciones(id) ON DELETE CASCADE;

-- Drop old tables
DROP TABLE IF EXISTS corrales CASCADE;
DROP TABLE IF EXISTS feedlots CASCADE;
DROP TABLE IF EXISTS lotes CASCADE;
