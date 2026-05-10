require("dotenv").config();
const { query, pool, testConnection } = require("../../src/config/database");
const { registrarPrecioPapaDesdeCanon, upsertAnalisisPapa } = require("../../src/services/horticola");

async function run() {
  await testConnection();
  const rowsR = await query(
    `
      SELECT cultivo, mercado, precio, moneda, fecha, tipo_precio, calidad, presentacion, volumen_ingreso_nivel, volumen_ingreso_fuente
      FROM precios
      WHERE LOWER(cultivo) = 'papa'
      ORDER BY fecha ASC, mercado ASC
    `
  );
  let insertados = 0;
  const fechas = new Set();
  for (const row of rowsR.rows || []) {
    try {
      insertados += await registrarPrecioPapaDesdeCanon(row, {
        valor: Number(row.precio),
        moneda: row.moneda,
      });
      if (row.fecha) fechas.add(String(row.fecha).slice(0, 10));
    } catch (_error) {
      // best effort
    }
  }
  let analisis = 0;
  for (const f of fechas) {
    try {
      analisis += await upsertAnalisisPapa({ fecha: f, mercado: "MCBA" });
    } catch (_error) {
      // best effort
    }
  }
  console.log(JSON.stringify({ ok: true, leidos: rowsR.rows.length, insertados, analisis }, null, 2));
}

run()
  .catch((error) => {
    console.error("Backfill hortícola falló:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
