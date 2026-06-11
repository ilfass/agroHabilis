"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== SEARCHING FOR 'DAEDAS' IN HISTORIAL_CONSULTAS ===");
    const res = await pool.query(
      `SELECT id, creado_en, usuario_id, whatsapp, pregunta, respuesta, ia_provider FROM historial_consultas 
       WHERE pregunta ILIKE '%Daedas%' OR respuesta ILIKE '%Daedas%'`
    );
    console.log(`Found ${res.rows.length} rows`);
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] ID: ${r.id} | User: ${r.usuario_id} | WA: ${r.whatsapp} | Provider: ${r.ia_provider}
Q: ${r.pregunta}
A: ${r.respuesta}
----------------------------------------`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
