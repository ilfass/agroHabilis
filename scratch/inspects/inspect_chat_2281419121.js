"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const phone = "5492281419121";
  console.log("=== INSPECTING HISTORY FOR:", phone, "===");
  
  // Find user details
  const userRes = await query(
    `SELECT id, nombre, plan FROM usuarios WHERE whatsapp LIKE $1 OR whatsapp_real LIKE $1`,
    [`%2281419121%`]
  );
  
  if (userRes.rows.length === 0) {
    console.log("No user found in usuarios table.");
    process.exit(0);
  }

  const user = userRes.rows[0];
  console.log("User details:", JSON.stringify(user, null, 2));
  
  // Find interaction logs
  const logsRes = await query(
    `SELECT creado_en, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
     WHERE usuario_id = $1 
     ORDER BY creado_en DESC LIMIT 15`,
    [user.id]
  );
  
  console.log(`\n--- Interaction logs (${logsRes.rows.length}) ---`);
  for (const r of logsRes.rows) {
    console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()} (Ruta: ${r.ruta}):`);
    console.log(r.cuerpo);
    console.log("------------------------");
  }

  // Find general history
  const histRes = await query(
    `SELECT creado_en, pregunta, respuesta FROM historial_consultas 
     WHERE usuario_id = $1 
     ORDER BY creado_en DESC LIMIT 10`,
    [user.id]
  );
  
  console.log(`\n--- Historial Consultas (${histRes.rows.length}) ---`);
  for (const r of histRes.rows) {
    console.log(`[${r.creado_en.toISOString()}] User: ${r.pregunta}`);
    console.log(`Bot: ${r.respuesta}`);
    console.log("========================");
  }

  process.exit(0);
}

main().catch(console.error);
