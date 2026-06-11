"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  try {
    const res = await query(
      `SELECT pregunta FROM historial_consultas WHERE pregunta LIKE '%Plano catastral%' ORDER BY creado_en DESC LIMIT 5`
    );
    console.log(`Found ${res.rows.length} rows:`);
    for (let i = 0; i < res.rows.length; i++) {
      console.log(`--- Row ${i + 1} ---`);
      console.log(res.rows[i].pregunta);
    }
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

main();
