"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== INVENTARIO_SALDO FOR USER 521 ===");
    const res = await pool.query(
      `SELECT id, lote_id, campana_id, dominio, item_clave, cantidad, unidad, etiqueta, actualizado_en, ultimo_movimiento_id 
       FROM inventario_saldo 
       WHERE usuario_id = 521`
    );
    for (const r of res.rows) {
      console.log(`ID: ${r.id}, Lote: ${r.lote_id}, Dominio: ${r.dominio}, Clave: "${r.item_clave}", Cantidad: ${r.cantidad}, Etiqueta: "${r.etiqueta}", Ultimo Mov: ${r.ultimo_movimiento_id}`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
