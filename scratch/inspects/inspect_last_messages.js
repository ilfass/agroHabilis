require("dotenv").config();
const { query } = require("../src/config/database");
async function main() {
  const res = await query(
    `SELECT creado_en, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
     WHERE usuario_id = 575 
     ORDER BY creado_en DESC LIMIT 4`
  );
  for (const r of res.rows) {
    console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()} (Ruta: ${r.ruta}):`);
    console.log(r.cuerpo);
    console.log("------------------------");
  }
  process.exit(0);
}
main();
