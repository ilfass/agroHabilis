const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkQueries() {
  const usuarioId = 1;
  const queries = [
    `SELECT e.id, e.titulo, e.descripcion, e.fecha_inicio, e.fecha_fin, e.categoria, e.ubicacion_id, l.nombre AS lote_nombre, 'manual' AS origen FROM eventos_calendario e LEFT JOIN ubicaciones l ON l.id = e.ubicacion_id WHERE e.usuario_id = $1`,
    `SELECT id, 'Siembra de ' || cultivo || ' - Lote ' || nombre AS titulo, 'Variedad: ' || COALESCE(variedad, 'N/C') || '. Densidad: ' || COALESCE(densidad::text, 'N/C') AS descripcion, fecha_siembra AS fecha_inicio, fecha_siembra AS fecha_fin, 'agricultura' AS categoria, id AS ubicacion_id, nombre AS lote_nombre, 'siembra' AS origen FROM ubicaciones WHERE usuario_id = $1 AND fecha_siembra IS NOT NULL`,
    `SELECT id, ubicacion_id, lote_nombre, tipo AS tipo_evento, 'pastura' AS origen FROM eventos_pastura WHERE usuario_id = $1`,
    `SELECT e.id, a.ubicacion_id, l.nombre AS lote_nombre, 'animal' AS origen FROM animales_eventos e JOIN animales_individuales a ON a.id = e.animal_id LEFT JOIN ubicaciones l ON l.id = a.ubicacion_id WHERE e.usuario_id = $1`,
    `SELECT t.id, t.ubicacion_id, l.nombre AS lote_nombre, 'telemetria' AS origen FROM telemetria_labores t LEFT JOIN ubicaciones l ON l.id = t.ubicacion_id WHERE t.usuario_id = $1`,
    `SELECT r.id, NULL::int AS ubicacion_id, r.lote_nombre, 'labor_manual' AS origen FROM registro_labores_maquinaria r WHERE r.usuario_id = $1`
  ];

  for (let i = 0; i < queries.length; i++) {
    try {
      await pool.query(queries[i], [usuarioId]);
      console.log(`Query ${i+1}: OK`);
    } catch (e) {
      console.log(`Query ${i+1} FAILED: ${e.message}`);
    }
  }
  process.exit(0);
}
checkQueries();
