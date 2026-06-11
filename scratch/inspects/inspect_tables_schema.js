"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const tables = ['inventario_movimiento', 'inventario_saldo', 'lotes'];
    for (const t of tables) {
      console.log(`\n=== Columns of ${t} ===`);
      const res = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
        [t]
      );
      for (const row of res.rows) {
        console.log(`- ${row.column_name} (${row.data_type})`);
      }
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
