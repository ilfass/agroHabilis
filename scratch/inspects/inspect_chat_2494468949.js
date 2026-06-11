"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING CHAT FOR 2494468949 ===");
  
  // Try connecting via the tunnel port 15433 first.
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm LIKE '%2494468949%'
       ORDER BY creado_en DESC LIMIT 40`
    );
    console.log(`\nFound ${res.rows.length} interaction log entries:`);
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()}: ${r.cuerpo} (Ruta: ${r.ruta})`);
    }

    const res2 = await pool.query(
      `SELECT creado_en, pregunta, respuesta, usuario_id FROM historial_consultas 
       WHERE whatsapp LIKE '%2494468949%'
       ORDER BY creado_en DESC LIMIT 20`
    );
    console.log(`\nFound ${res2.rows.length} general history entries:`);
    for (const r of res2.rows) {
      console.log(`[${r.creado_en.toISOString()}] User: ${r.pregunta}\nBot: ${r.respuesta}\n`);
    }

  } catch (err) {
    console.error("Error connecting via local tunnel:", err.message);
  } finally {
    await pool.end();
  }
}

main();
