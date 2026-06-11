"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== PENDING MOVEMENTS ===");
    const res = await pool.query(
      `SELECT * FROM inventario_movimiento WHERE usuario_id = 487`
    );
    console.log(JSON.stringify(res.rows, null, 2));

    console.log("\n=== CONVERSATION STATE ===");
    const resState = await pool.query(
      `SELECT * FROM conversacion_estado`
    );
    console.log(JSON.stringify(resState.rows, null, 2));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
