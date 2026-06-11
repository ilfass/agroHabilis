"use strict";
require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const res = await query(
    `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta 
     FROM whatsapp_interaccion_log 
     ORDER BY creado_en DESC LIMIT 15`
  );
  console.log(`=== RECENT INTERACTION LOGS (ALL USERS) ===`);
  for (const r of res.rows) {
    console.log(`[${r.creado_en.toISOString()}] JID/Phone: ${r.whatsapp_norm} (UserID: ${r.usuario_id}) | ${r.direccion.toUpperCase()} | Ruta: ${r.ruta}`);
    console.log(`Body: ${r.cuerpo ? r.cuerpo.substring(0, 250) : "NULL"}`);
    console.log("---------------------------------------");
  }
}
main().catch(console.error);
