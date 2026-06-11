"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== DUMPING ENTIRE CHAT FOR 2494468949 ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm LIKE '%2494468949%'
       ORDER BY creado_en ASC`
    );
    console.log(`\nFound ${res.rows.length} interaction log entries (chronological):`);
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()}: ${r.cuerpo} (Ruta: ${r.ruta})`);
      console.log("-".repeat(60));
    }

    const res2 = await pool.query(
      `SELECT creado_en, pregunta, respuesta, usuario_id FROM historial_consultas 
       WHERE whatsapp LIKE '%2494468949%'
       ORDER BY creado_en ASC`
    );
    console.log(`\nFound ${res2.rows.length} general history entries (chronological):`);
    for (const r of res2.rows) {
      console.log(`[${r.creado_en.toISOString()}] User: ${r.pregunta}\nBot: ${r.respuesta}`);
      console.log("=".repeat(60));
    }

  } catch (err) {
    console.error("Error connecting via local tunnel:", err.message);
  } finally {
    await pool.end();
  }
}

main();
