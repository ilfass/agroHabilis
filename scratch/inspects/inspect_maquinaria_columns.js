"use strict";

const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: "postgresql://postgres:postgres@127.0.0.1:15433/agrointel" });

  try {
    console.log("=== COLUMNS IN registro_labores_maquinaria ===");
    const res = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'registro_labores_maquinaria'`
    );
    for (const r of res.rows) {
      console.log(`- ${r.column_name} (${r.data_type})`);
    }

    console.log("\n=== DATA IN registro_labores_maquinaria ===");
    const dataRes = await pool.query("SELECT * FROM registro_labores_maquinaria LIMIT 5");
    console.log(JSON.stringify(dataRes.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
