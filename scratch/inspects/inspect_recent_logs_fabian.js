"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== INSPECTING DETAILED WHATSAPP LOGS ===");
    const res = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm LIKE '%2494468949%' OR whatsapp_norm LIKE '%2494218078%' OR whatsapp_norm LIKE '%2281548505%'
       ORDER BY creado_en DESC LIMIT 100`
    );
    
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()} | User: ${r.usuario_id} | Norm: ${r.whatsapp_norm} | Ruta: ${r.ruta}\nText: ${r.cuerpo}\n----------------------------------------`);
    }

    console.log("\n=== HISTORIAL DE CONSULTAS DE FABIAN ===");
    const resQueries = await pool.query(
      `SELECT id, creado_en, usuario_id, pregunta, respuesta, ia_provider FROM historial_consultas 
       WHERE usuario_id = 487 OR pregunta ILIKE '%vacas%' OR pregunta ILIKE '%ganado%' OR pregunta ILIKE '%lote%'
       ORDER BY creado_en DESC LIMIT 20`
    );
    for (const r of resQueries.rows) {
      console.log(`[${r.creado_en.toISOString()}] ID: ${r.id} | User: ${r.usuario_id}\nQ: ${r.pregunta}\nA: ${r.respuesta}\n----------------------------------------`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
