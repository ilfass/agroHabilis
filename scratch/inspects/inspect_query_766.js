"use strict";

const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: "postgresql://postgres:postgres@127.0.0.1:15433/agrointel" });

  try {
    console.log("=== INSPECTING QUERY 766 ===");
    const res = await pool.query("SELECT * FROM historial_consultas WHERE id = 766");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
