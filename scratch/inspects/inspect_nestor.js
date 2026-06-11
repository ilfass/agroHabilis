"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING USER 538 AND POTATO TABLES ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query("SELECT * FROM usuarios WHERE id = 538 OR whatsapp LIKE '%2494468949%'");
    console.log("--- User Info ---");
    console.log(res.rows);

    const preciosGeneralCount = await pool.query(
      "SELECT COUNT(*) FROM precios WHERE LOWER(cultivo) = 'papa'"
    );
    console.log("\n--- Precios General Count for 'papa' ---");
    console.log(preciosGeneralCount.rows[0]);

    const latestPreciosGeneral = await pool.query(
      "SELECT * FROM precios WHERE LOWER(cultivo) = 'papa' ORDER BY fecha DESC LIMIT 5"
    );
    console.log("\n--- Latest Precios General for 'papa' ---");
    console.log(latestPreciosGeneral.rows);

    const latestPreciosHorticolas = await pool.query(
      "SELECT * FROM precios_horticolas WHERE producto = 'papa' ORDER BY fecha DESC LIMIT 5"
    );
    console.log("\n--- Latest Precios Horticolas for 'papa' ---");
    console.log(latestPreciosHorticolas.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
