"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  console.log("=== INSPECTING LOTES FOR USER 575 ===");
  try {
    const res = await query(
      `SELECT id, nombre, cliente, firma, creado_en FROM lotes WHERE usuario_id = 575`
    );
    console.log(`Found ${res.rows.length} rows in lotes:`);
    for (const r of res.rows) {
      console.log(JSON.stringify(r, null, 2));
    }
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

main();
