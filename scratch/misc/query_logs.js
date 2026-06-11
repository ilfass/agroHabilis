"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(`
      SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta 
      FROM whatsapp_interaccion_log 
      ORDER BY creado_en DESC 
      LIMIT 100
    `);
    
    console.log("=== LAST 100 INTERACTION LOGS ===");
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] User: ${r.usuario_id} | Norm: ${r.whatsapp_norm} | ${r.direccion.toUpperCase()}: ${r.cuerpo.substring(0, 100)} (Ruta: ${r.ruta})`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
