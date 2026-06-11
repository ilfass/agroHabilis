"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const uId = 521;
    console.log(`\n=== Movements for User ID ${uId} ===`);
    const res = await pool.query(
      `SELECT id, creado_en, lote_id, campana_id, dominio, clase, efecto, payload, estado, texto_nl 
       FROM inventario_movimiento 
       WHERE usuario_id = $1 
       ORDER BY creado_en DESC LIMIT 10`,
      [uId]
    );
    for (const r of res.rows) {
      console.log(`[${r.creado_en.toISOString()}] ID: ${r.id}, Lote: ${r.lote_id}, Dominio: ${r.dominio}, Estado: ${r.estado}, Texto: "${r.texto_nl}"`);
      console.log(`  Payload: ${JSON.stringify(r.payload)}`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
