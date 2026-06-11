require("dotenv").config();
const { query } = require("../src/config/database");
async function main() {
  console.log("=== INSPECTING LOGS FOR JUAN BARREIRO ===");
  const res = await query(
    `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta 
     FROM whatsapp_interaccion_log 
     WHERE whatsapp_norm LIKE '%50225448284249%' OR whatsapp_norm LIKE '%2281419121%' OR usuario_id = 575
     ORDER BY creado_en DESC LIMIT 10`
  );
  console.log(`Found ${res.rows.length} rows:`);
  for (const r of res.rows) {
    console.log(`[${r.creado_en.toISOString()}] JID/Phone: ${r.whatsapp_norm} (UserID: ${r.usuario_id}) | ${r.direccion.toUpperCase()} (Ruta: ${r.ruta}):`);
    console.log(r.cuerpo);
    console.log("------------------------");
  }
  process.exit(0);
}
main();
