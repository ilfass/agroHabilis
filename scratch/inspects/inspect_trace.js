"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT * FROM historial_consultas 
       WHERE pregunta ILIKE '%Fiamma Mayora%' OR respuesta ILIKE '%Fiamma Mayora%'
       ORDER BY creado_en DESC LIMIT 5`
    );
    for (const row of res.rows) {
      console.log(`\n=== ID: ${row.id} | Creado: ${row.creado_en.toISOString()} ===`);
      console.log(`Pregunta: ${row.pregunta}`);
      console.log(`Respuesta: ${row.respuesta}`);
      console.log(`IA Provider: ${row.ia_provider}`);
      console.log("IA Provider Trace:", JSON.stringify(row.ia_provider_trace, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
