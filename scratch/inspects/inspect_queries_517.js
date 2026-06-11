"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(`
      SELECT id, creado_en, pregunta, respuesta, ia_provider, ia_provider_trace 
      FROM historial_consultas 
      WHERE usuario_id = 517 
      ORDER BY creado_en ASC
    `);
    
    console.log("=== QUERIES FOR USER 517 ===");
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] Query ID: ${r.id} | Provider: ${r.ia_provider}`);
      console.log(`Q: ${r.pregunta}`);
      console.log(`A: ${r.respuesta}`);
      console.log(`Trace: ${JSON.stringify(r.ia_provider_trace, null, 2)}`);
      console.log("-------------------------------------------------------------");
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
