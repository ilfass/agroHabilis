"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  console.log("=== RECENT WHATSAPP LOGS (ALL USERS) ===");
  const logs = await query(
    `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta 
     FROM whatsapp_interaccion_log 
     ORDER BY creado_en DESC LIMIT 30`
  );
  
  for (const r of logs.rows) {
    console.log(`[${r.creado_en.toISOString()}] ${r.whatsapp_norm} (${r.direccion}) (User: ${r.usuario_id}):`);
    console.log(`Body: "${r.cuerpo.slice(0, 300)}"`);
    console.log("------------------------");
  }

  console.log("\n=== RECENT HISTORIAL CONSULTAS (ALL USERS) ===");
  const hist = await query(
    `SELECT creado_en, whatsapp, pregunta, respuesta, usuario_id 
     FROM historial_consultas 
     ORDER BY creado_en DESC LIMIT 15`
  );
  
  for (const r of hist.rows) {
    console.log(`[${r.creado_en.toISOString()}] Phone: ${r.whatsapp} (User: ${r.usuario_id}):`);
    console.log(`Q: "${r.pregunta.slice(0, 200)}"`);
    console.log(`A: "${r.respuesta.slice(0, 200)}"`);
    console.log("========================");
  }

  process.exit(0);
}

main().catch(console.error);
