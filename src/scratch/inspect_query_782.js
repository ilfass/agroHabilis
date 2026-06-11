"use strict";

const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: "postgresql://postgres:postgres@127.0.0.1:15433/agrointel" });

  try {
    console.log("=== INSPECTING QUERIES 781, 782, 783 ===");
    const res = await pool.query(
      "SELECT id, ia_provider, ia_provider_trace, pregunta, respuesta FROM historial_consultas WHERE id IN (781, 782, 783) ORDER BY id"
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
