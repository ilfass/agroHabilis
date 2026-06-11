"use strict";

require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query("SELECT NOW(), CURRENT_TIMESTAMP, clock_timestamp()");
    console.log("Database NOW():", res.rows[0]);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
