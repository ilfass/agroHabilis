"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING DIEGO FIGUEROA'S LID LOGS ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const searchedLID = "208683921358918";
    const searchedReal = "5492494218078";
    
    // 1. Search in whatsapp_interaccion_log
    const resLog = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE cuerpo ILIKE '%bolsa%' OR cuerpo ILIKE '%maiz%' OR cuerpo ILIKE '%maíz%'
       ORDER BY creado_en DESC LIMIT 40`
    );
    console.log(`\nFound ${resLog.rows.length} records in 'whatsapp_interaccion_log':`);
    for (const r of resLog.rows) {
      console.log(`[${r.creado_en.toISOString()}] UserID: ${r.usuario_id} | WA: ${r.whatsapp_norm} | ${r.direccion.toUpperCase()}: ${r.cuerpo} (Ruta: ${r.ruta})`);
    }

    // 2. Search in historial_consultas
    const resHist = await pool.query(
      `SELECT creado_en, whatsapp, pregunta, respuesta, ia_provider, ia_provider_trace FROM historial_consultas 
       WHERE pregunta ILIKE '%bolsa%' OR pregunta ILIKE '%maiz%' OR pregunta ILIKE '%maíz%' OR respuesta ILIKE '%bolsa%' OR respuesta ILIKE '%maiz%' OR respuesta ILIKE '%maíz%'
       ORDER BY creado_en DESC LIMIT 10`
    );
    console.log(`\nFound ${resHist.rows.length} records in 'historial_consultas':`);
    for (const r of resHist.rows) {
      console.log(`[${r.creado_en.toISOString()}] WA: ${r.whatsapp}`);
      console.log(`  Q: ${r.pregunta}`);
      console.log(`  A: ${r.respuesta}`);
      console.log("-".repeat(50));
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
