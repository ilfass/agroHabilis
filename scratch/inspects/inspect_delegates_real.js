"use strict";

const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: "postgresql://postgres:postgres@127.0.0.1:15433/agrointel" });

  try {
    console.log("=== SEARCHING DELEGATE NUMBERS IN INTERACTION LOGS ===");
    
    // Let's search with LIKE to find any variation of the numbers
    const res = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm LIKE '%2494218078%' 
          OR whatsapp_norm LIKE '%2281548505%'
          OR cuerpo LIKE '%50 cabezas%'
          OR cuerpo LIKE '%Figueroa%'
       ORDER BY creado_en DESC LIMIT 50`
    );

    console.log(`Found ${res.rows.length} rows:`);
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] Num: ${r.whatsapp_norm} | UserID: ${r.usuario_id} | ${r.direccion.toUpperCase()}: ${r.cuerpo} (Ruta: ${r.ruta})`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
