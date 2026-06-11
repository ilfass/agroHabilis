"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const whatsapp = "5492494468949";
  console.log("=== CHECKING STATE FOR WHATSAPP:", whatsapp, "===");

  // 1. Check conversacion_estado
  const stateRes = await query(
    `SELECT * FROM conversacion_estado WHERE whatsapp = $1 OR whatsapp LIKE $2`,
    [whatsapp, `%${whatsapp.slice(-10)}%`]
  );
  console.log("\n--- Active states in conversacion_estado ---");
  console.log(JSON.stringify(stateRes.rows, null, 2));

  // 2. Check recent whatsapp_interaccion_log
  const captRes = await query(
    `SELECT id, whatsapp_norm, direccion, cuerpo, ruta, creado_en 
     FROM whatsapp_interaccion_log 
     WHERE whatsapp_norm = $1 OR whatsapp_norm LIKE $2
     ORDER BY creado_en DESC 
     LIMIT 25`,
    [whatsapp, `%${whatsapp.slice(-10)}%`]
  );
  console.log("\n--- Recent interacciones_captura ---");
  captRes.rows.reverse().forEach(row => {
    console.log(`[${row.creado_en.toISOString()}] ${row.direccion.toUpperCase()} (${row.ruta}): "${row.cuerpo.replace(/\n/g, ' ')}"`);
  });
}

main().catch(console.error);
