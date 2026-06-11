"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== LISTING DB SCHEMAS ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const resUser = await pool.query(
      `SELECT id, nombre, whatsapp, whatsapp_real FROM usuarios 
       WHERE whatsapp LIKE '%2494468949%' OR whatsapp_real LIKE '%2494468949%'`
    );
    const userId = resUser.rows[0]?.id;
    console.log(`User ID: ${userId} (${resUser.rows[0]?.nombre})`);

    const tablesRes = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log("\n=== TABLES IN DB ===");
    console.log(tables.join(", "));

    // Print columns for table 'lotes'
    const colsLotes = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'lotes'"
    );
    console.log("\n=== COLUMNS IN lotes ===");
    console.table(colsLotes.rows);

    // Let's search for similar tables like "movimientos", "inventario", "cargas", "transacciones", "registros"
    const matched = tables.filter(t => t.includes("inventario") || t.includes("movimiento") || t.includes("registro") || t.includes("gasto") || t.includes("venta") || t.includes("hacienda") || t.includes("cuidado") || t.includes("tratamiento") || t.includes("animal"));
    console.log("\n=== MATCHING TABLES ===");
    console.log(matched.join(", "));

    for (const tbl of matched) {
      try {
        const countRes = await pool.query(`SELECT COUNT(*) FROM "${tbl}"`);
        console.log(`- Table "${tbl}": ${countRes.rows[0].count} total rows`);

        // If table has usuario_id or similar, check count for this user
        const cols = await pool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = '${tbl}'`
        );
        const colNames = cols.rows.map(c => c.column_name);
        
        if (colNames.includes("usuario_id")) {
          const userCountRes = await pool.query(`SELECT COUNT(*) FROM "${tbl}" WHERE usuario_id = $1`, [userId]);
          console.log(`  -> For User ${userId}: ${userCountRes.rows[0].count} rows`);
          
          if (Number(userCountRes.rows[0].count) > 0) {
            const dataRes = await pool.query(`SELECT * FROM "${tbl}" WHERE usuario_id = $1 ORDER BY 1 DESC LIMIT 5`, [userId]);
            console.log(`  -> Recent 5 entries in "${tbl}":`);
            console.table(dataRes.rows);
          }
        }
      } catch (err) {
        console.log(`- Table "${tbl}" query failed: ${err.message}`);
      }
    }

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
}

main();
