"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const userId = 487;
    console.log(`=== CHECKING ALL TABLES FOR USER_ID = ${userId} ===`);

    const tables = [
      "usuario_cultivos",
      "alertas",
      "perfil_productivo",
      "campanas_agricolas",
      "lotes",
      "stock_ganadero",
      "gastos",
      "ventas",
      "animales_individuales",
      "animales_eventos",
      "inventario_movimiento",
      "inventario_saldo",
      "telemetria_labores",
      "registro_labores_maquinaria",
      "monitoreo_agricola"
    ];

    for (const table of tables) {
      try {
        const res = await pool.query(`SELECT COUNT(*) FROM ${table} WHERE usuario_id = $1`, [userId]);
        const count = res.rows[0].count;
        if (count > 0) {
          console.log(`- ${table}: ${count} rows found!`);
          const details = await pool.query(`SELECT * FROM ${table} WHERE usuario_id = $1 LIMIT 5`, [userId]);
          console.log(JSON.stringify(details.rows, null, 2));
        } else {
          console.log(`- ${table}: 0 rows`);
        }
      } catch (err) {
        console.log(`- ${table}: Error - ${err.message}`);
      }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
