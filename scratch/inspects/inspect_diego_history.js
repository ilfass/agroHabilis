"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING HISTORY DETAILS FOR '208683921358918' ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT creado_en, usuario_id, whatsapp, pregunta, respuesta, ia_provider, ia_provider_trace 
       FROM historial_consultas 
       WHERE whatsapp LIKE '%208683921358918%'
       ORDER BY creado_en DESC LIMIT 10`
    );
    console.log(`Found ${res.rows.length} records:`);
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] UserID: ${r.usuario_id} | WA: ${r.whatsapp}`);
      console.log(`Q: ${r.pregunta}`);
      console.log(`A: ${r.respuesta}`);
      console.log(`IA Provider: ${r.ia_provider}`);
      console.log(`IA Provider Trace:`, JSON.stringify(r.ia_provider_trace, null, 2));
      console.log("-".repeat(50));
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
