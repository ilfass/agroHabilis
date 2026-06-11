"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const userId = 575; // Juan Barreiro
  
  const res = await query(
    `SELECT * FROM telefonos_autorizados WHERE usuario_principal_id = $1`,
    [userId]
  );
  
  console.log(`=== DELEGATES FOR JUAN BARREIRO (${res.rows.length}) ===`);
  console.log(JSON.stringify(res.rows, null, 2));
  
  // Also check if there are any interaction logs for these delegate phone numbers
  for (const row of res.rows) {
    const phone = row.whatsapp_autorizado;
    const logs = await query(
      `SELECT creado_en, direccion, cuerpo, ruta 
       FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm LIKE $1 OR cuerpo LIKE $1 
       ORDER BY creado_en DESC LIMIT 5`,
      [`%${phone}%`]
    );
    console.log(`\nLogs for delegate phone ${phone} (${row.nombre_contacto}):`);
    for (const r of logs.rows) {
      console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()}: ${r.cuerpo.slice(0, 200)}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
