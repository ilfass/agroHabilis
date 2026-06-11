"use strict";

require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("\n=== Fetching Chronological historial_consultas ===");
    const resHist = await pool.query(
      `SELECT creado_en, pregunta, respuesta, ia_provider, ia_provider_trace FROM historial_consultas 
       WHERE usuario_id = 538
       ORDER BY creado_en ASC`
    );
    console.log(`Found ${resHist.rows.length} general history entries:`);
    for (const r of resHist.rows) {
      console.log(`\n[${r.creado_en.toISOString()}]`);
      console.log(`User: ${r.pregunta}`);
      console.log(`Bot: ${r.respuesta}`);
      console.log(`Provider: ${r.ia_provider}`);
      console.log(`Trace: ${JSON.stringify(r.ia_provider_trace, null, 2)}`);
    }

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

main();
