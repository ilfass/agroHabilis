"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== INSPECTING DELEGATES INTERACTION LOG ===");
    const resDiego = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm = '5492494218078' OR whatsapp_norm = '5492281548505'
       ORDER BY creado_en DESC LIMIT 100`
    );
    console.log(`Found ${resDiego.rows.length} rows for delegates:`);
    for (const r of resDiego.rows) {
      console.log(`[${r.creado_en.toISOString()}] Num: ${r.whatsapp_norm} | UserID: ${r.usuario_id} | ${r.direccion.toUpperCase()}: ${r.cuerpo} (Ruta: ${r.ruta})`);
    }

    console.log("\n=== CHECKING IF '50 cabezas' WAS SAVED IN database tables ===");
    // Let's query 'ventas', 'animales_individuales', 'animales_eventos', 'gastos', etc.
    const resVentas = await pool.query(
      `SELECT * FROM ventas ORDER BY creado_en DESC LIMIT 10`
    );
    console.log("\n--- Ventas table ---");
    console.log(JSON.stringify(resVentas.rows, null, 2));

    const resAnimalesEventos = await pool.query(
      `SELECT * FROM animales_eventos ORDER BY creado_en DESC LIMIT 10`
    );
    console.log("\n--- Animales Eventos table ---");
    console.log(JSON.stringify(resAnimalesEventos.rows, null, 2));

    const resStockGanadero = await pool.query(
      `SELECT * FROM stock_ganadero ORDER BY creado_en DESC LIMIT 10`
    );
    console.log("\n--- Stock Ganadero table ---");
    console.log(JSON.stringify(resStockGanadero.rows, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
