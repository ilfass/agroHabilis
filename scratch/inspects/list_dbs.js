"use strict";

const { Pool } = require("pg");

async function main() {
  const connectionString = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
  try {
    const res = await pool.query("SELECT datname FROM pg_database WHERE datistemplate = false");
    console.log("Databases on port 5432:", res.rows.map(r => r.datname));
    await pool.end();
  } catch (err) {
    console.error("Error listing databases:", err.message);
    await pool.end();
  }
}

main();
