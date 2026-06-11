"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING WEATHER LOGS IN DATABASE ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE cuerpo ILIKE '%clima%' OR cuerpo ILIKE '%pronostico%' OR cuerpo ILIKE '%tiempo%' OR cuerpo ILIKE '%lluvia%'
       ORDER BY creado_en DESC LIMIT 30`
    );
    console.log(`\nFound ${res.rows.length} weather-related interaction logs:`);
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] User: ${r.usuario_id} | Num: ${r.whatsapp_norm} | DIR: ${r.direccion.toUpperCase()} | Ruta: ${r.ruta}`);
      console.log(`Text: ${r.cuerpo}`);
      console.log("-".repeat(60));
    }

    const res2 = await pool.query(
      `SELECT creado_en, pregunta, respuesta, usuario_id FROM historial_consultas 
       WHERE pregunta ILIKE '%clima%' OR pregunta ILIKE '%pronostico%' OR pregunta ILIKE '%tiempo%' OR pregunta ILIKE '%lluvia%'
       ORDER BY creado_en DESC LIMIT 15`
    );
    console.log(`\nFound ${res2.rows.length} weather-related general history entries:`);
    for (const r of res2.rows) {
      console.log(`[${r.creado_en.toISOString()}] User: ${r.usuario_id}\nQ: ${r.pregunta}\nA: ${r.respuesta}`);
      console.log("=".repeat(60));
    }

  } catch (err) {
    console.error("Error connecting via local tunnel:", err.message);
  } finally {
    await pool.end();
  }
}

main();
