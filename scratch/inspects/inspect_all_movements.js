"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== COUNT OF MOVEMENTS BY USER AND STATUS ===");
    const resCount = await pool.query(
      `SELECT usuario_id, estado, COUNT(*) FROM inventario_movimiento GROUP BY usuario_id, estado`
    );
    console.log(JSON.stringify(resCount.rows, null, 2));

    console.log("\n=== ALL MOVEMENTS FROM PREVIOUS 2 DAYS ===");
    const resAll = await pool.query(
      `SELECT id, usuario_id, dominio, clase, estado, payload, creado_en, texto_nl 
       FROM inventario_movimiento 
       ORDER BY creado_en DESC LIMIT 30`
    );
    for (const r of resAll.rows) {
      console.log(`ID: ${r.id} | User: ${r.usuario_id} | Dom: ${r.dominio} | Est: ${r.estado} | Creado: ${r.creado_en.toISOString()} | NL: ${r.texto_nl}\nPayload: ${JSON.stringify(r.payload)}\n----------------------------------------`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
