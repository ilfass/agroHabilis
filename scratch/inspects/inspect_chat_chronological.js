"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== CHRONOLOGICAL LOGS (02:53 to 03:01) ===");
    const res = await pool.query(
      `SELECT creado_en, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm = '5492494468949' AND creado_en >= '2026-05-28 02:53:00' AND creado_en <= '2026-05-28 03:01:00'
       ORDER BY creado_en ASC`
    );
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()}: ${r.cuerpo} (Ruta: ${r.ruta})`);
    }

    console.log("\n=== CONVERSION HISTORIAL_CONSULTAS ===");
    const res2 = await pool.query(
      `SELECT creado_en, pregunta, respuesta FROM historial_consultas 
       WHERE whatsapp = '5492494468949' AND creado_en >= '2026-05-28 02:53:00' AND creado_en <= '2026-05-28 03:01:00'
       ORDER BY creado_en ASC`
    );
    for (const r of res2.rows) {
      console.log(`[${r.creado_en.toISOString()}]\n  Pregunta:  ${r.pregunta}\n  Respuesta: ${r.respuesta}\n`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
