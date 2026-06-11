require("dotenv").config();
const { query } = require("../src/config/database");
async function main() {
  console.log("=== INSPECTING HISTORIAL FOR JUAN BARREIRO ===");
  const res = await query(
    `SELECT creado_en, pregunta, respuesta, ia_provider 
     FROM historial_consultas 
     WHERE usuario_id = 575
     ORDER BY creado_en DESC LIMIT 5`
  );
  console.log(`Found ${res.rows.length} rows:`);
  for (const r of res.rows) {
    console.log(`[${r.creado_en.toISOString()}] Provider: ${r.ia_provider}`);
    console.log(`Q: "${r.pregunta}"`);
    console.log(`A: "${r.respuesta}"`);
    console.log("------------------------");
  }
  process.exit(0);
}
main();
