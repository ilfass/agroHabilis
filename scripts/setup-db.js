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
  contenido TEXT NOT NULL,
  enviado_wp BOOLEAN DEFAULT false,
  enviado_en TIMESTAMP,
  tokens_usados INTEGER,
  creado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(usuario_id, fecha)
);

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
  creado_en TIMESTAMP DEFAULT NOW()
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
`;

const seedUsuarioSistemaSQL = `
INSERT INTO usuarios (nombre, whatsapp)
VALUES ('Resumen sistema', 'ahbl:sistema')
ON CONFLICT (whatsapp) DO NOTHING;
`;

const setupDatabase = async () => {
  try {
    await testConnection();
    await query(createTablesSQL);
    await query(seedUsuarioSistemaSQL);
    console.log("Tablas creadas/verificadas correctamente.");
  } catch (error) {
    console.error("Error durante setup de base de datos:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

setupDatabase();
