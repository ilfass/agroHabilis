"use strict";

const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: "postgresql://postgres:postgres@127.0.0.1:15433/agrointel" });

  try {
    console.log("=== DISTINCT WHATSAPP_NORM FOR USER_ID = 487 ===");
    const res = await pool.query(
      `SELECT DISTINCT whatsapp_norm FROM whatsapp_interaccion_log WHERE usuario_id = 487`
    );
    console.log(res.rows);

    console.log("\n=== ALL HISTORIAL_CONSULTAS FOR USER_ID = 487 (recent 10) ===");
    const resH = await pool.query(
      `SELECT id, creado_en, whatsapp, pregunta, respuesta FROM historial_consultas 
       WHERE usuario_id = 487 ORDER BY creado_en DESC LIMIT 10`
    );
    console.log(resH.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
