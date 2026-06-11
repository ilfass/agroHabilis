"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING INTERACTION LOGS VIA TUNNEL ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const searchedNum = "2494218078";
    
    // 1. Search in whatsapp_interaccion_log
    const resLog = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm LIKE $1 OR cuerpo LIKE $1
       ORDER BY creado_en DESC LIMIT 40`,
      [`%${searchedNum}%`]
    );
    console.log(`\nFound ${resLog.rows.length} records in 'whatsapp_interaccion_log' matching '${searchedNum}':`);
    for (const r of resLog.rows) {
      console.log(`[${r.creado_en.toISOString()}] UserID: ${r.usuario_id} | ${r.direccion.toUpperCase()}: ${r.cuerpo} (Ruta: ${r.ruta})`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
