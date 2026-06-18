const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkCols() {
  const tables = ['eventos_calendario', 'eventos_pastura', 'animales_eventos', 'animales_individuales', 'telemetria_labores'];
  for (const t of tables) {
    const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'ubicacion_id'`, [t]);
    console.log(`Table ${t}: has ubicacion_id? ${res.rows.length > 0}`);
  }
  process.exit(0);
}
checkCols();
