"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== LISTING RECENT INTERACTION LOGS IN GENERAL VIA TUNNEL ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       ORDER BY creado_en DESC LIMIT 50`
    );
    console.log(`\nLast 50 records in 'whatsapp_interaccion_log':`);
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] WA: ${r.whatsapp_norm} (UserID: ${r.usuario_id}) | ${r.direccion.toUpperCase()}: ${r.cuerpo.slice(0, 150)} (Ruta: ${r.ruta})`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
