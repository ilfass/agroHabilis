"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING FABIAN DE HARO IN 'usuarios' ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT id, nombre, plan, whatsapp, whatsapp_jid, whatsapp_real, activo FROM usuarios 
       WHERE nombre ILIKE '%fabian%' OR whatsapp LIKE '%2494468949%' OR whatsapp_real LIKE '%2494468949%' OR whatsapp LIKE '%3753918865442%'`
    );
    console.log("Found users:");
    console.log(JSON.stringify(res.rows, null, 2));

    // Let's also check all rows in telefonos_autorizados for Fabian
    const resDel = await pool.query(
      `SELECT * FROM telefonos_autorizados WHERE usuario_principal_id = 487`
    );
    console.log("\nDelegates for user 487:");
    console.log(JSON.stringify(resDel.rows, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
