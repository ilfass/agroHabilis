require("dotenv").config();
const { query } = require("../src/config/database");
async function main() {
  console.log("=== INSPECTING LATEST LOGS ===");
  const res = await query(
    `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta 
     FROM whatsapp_interaccion_log 
     ORDER BY creado_en DESC LIMIT 10`
  );
  for (const r of res.rows) {
    console.log(`[${r.creado_en.toISOString()}] JID/Phone: ${r.whatsapp_norm} (UserID: ${r.usuario_id}) | ${r.direccion.toUpperCase()} (Ruta: ${r.ruta}):`);
    console.log(r.cuerpo);
    console.log("------------------------");
  }
  process.exit(0);
}
main();
