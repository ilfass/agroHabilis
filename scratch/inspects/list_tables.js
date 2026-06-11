"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== LISTING DB TABLES VIA TUNNEL ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
    );
    console.log("Tables in public schema:");
    for (const row of res.rows) {
      console.log(`- ${row.table_name}`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
