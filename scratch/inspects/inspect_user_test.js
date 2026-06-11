"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const resUser = await pool.query(
      "SELECT * FROM usuarios WHERE whatsapp LIKE '%2494468949%'"
    );
    console.log("=== User details ===");
    if (resUser.rows.length > 0) {
      console.log("Columns:", Object.keys(resUser.rows[0]));
      console.log("Values:", resUser.rows[0]);
    } else {
      console.log("No user found.");
    }

    if (resUser.rows.length === 0) {
      console.log("No user found with number 2494468949.");
      return;
    }

    const userId = resUser.rows[0].id;

    const resLotes = await pool.query(
      "SELECT id, nombre, hectareas, tipo, provincia, partido, cultivo FROM lotes WHERE usuario_id = $1",
      [userId]
    );
    console.log("\n=== Lotes ===");
    console.log(resLotes.rows);

    const resCampanas = await pool.query(
      "SELECT id, nombre, activa FROM campanas WHERE usuario_id = $1",
      [userId]
    );
    console.log("\n=== Campanas ===");
    console.log(resCampanas.rows);

    const resSaldos = await pool.query(
      "SELECT id, item_clave, etiqueta, cantidad, unidad, lote_id, campana_id FROM saldos WHERE usuario_id = $1",
      [userId]
    );
    console.log("\n=== Saldos ===");
    console.log(resSaldos.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
