"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== INSPECTING QUERY 785 ===");
    const res = await pool.query(
      `SELECT * FROM historial_consultas WHERE id = 785`
    );
    console.log(JSON.stringify(res.rows, null, 2));

    console.log("\n=== INSPECTING INTERACTION LOGS AROUND THAT TIME ===");
    const resLogs = await pool.query(
      `SELECT * FROM whatsapp_interaccion_log 
       WHERE creado_en BETWEEN '2026-05-26T20:39:00Z' AND '2026-05-26T20:42:00Z'
       ORDER BY creado_en ASC`
    );
    console.log(JSON.stringify(resLogs.rows, null, 2));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
