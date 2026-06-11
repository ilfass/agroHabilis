"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== ALL LOGS FOR ROBERTO ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT id, creado_en, direccion, cuerpo, ruta 
       FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm = '5492494468949' OR usuario_id = 536
       ORDER BY creado_en ASC`
    );
    for (const r of res.rows) {
      console.log(`[ID: ${r.id}] [${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()} (Ruta: ${r.ruta}):`);
      console.log(r.cuerpo);
      console.log("-".repeat(40));
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
