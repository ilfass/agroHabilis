"use strict";
require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const res = await query(
    `SELECT creado_en, direccion, cuerpo, ruta 
     FROM whatsapp_interaccion_log 
     WHERE whatsapp_norm LIKE '%2281419121%' OR whatsapp_norm LIKE '%50225448284249%'
     ORDER BY creado_en DESC LIMIT 5`
  );
  console.log(`=== INTERACTION LOGS (COUNT: ${res.rows.length}) ===`);
  // Print oldest first
  for (const r of [...res.rows].reverse()) {
    console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()} | Ruta: ${r.ruta}`);
    console.log(`Body: ${r.cuerpo ? r.cuerpo.substring(0, 300) : "NULL"}...`);
    console.log("---------------------------------------");
  }
}
main().catch(console.error);
