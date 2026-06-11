"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  console.log("=== INSPECTING RECENT HISTORY (TODAY: 2026-06-05) ===");

  // Find user details for Juan
  const userRes = await query(
    `SELECT id, nombre, plan, whatsapp, whatsapp_real, whatsapp_jid FROM usuarios WHERE whatsapp LIKE '%2281419121%' OR nombre ILIKE '%Juan Barreiro%'`
  );
  
  if (userRes.rows.length === 0) {
    console.log("No user found.");
    process.exit(0);
  }

  const user = userRes.rows[0];
  console.log("User details:", JSON.stringify(user, null, 2));

  // Find interaction logs
  const logsRes = await query(
    `SELECT creado_en, direccion, cuerpo, ruta 
     FROM whatsapp_interaccion_log 
     WHERE (usuario_id = $1 OR whatsapp_norm LIKE $2 OR whatsapp_norm LIKE $3)
     ORDER BY creado_en DESC LIMIT 3`,
    [user.id, `%2281419121%`, `%50225448284249%`]
  );
  
  console.log(`\n--- Interaction logs (${logsRes.rows.length}) ---`);
  const logsReversed = [...logsRes.rows].reverse();
  for (const r of logsReversed) {
    console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()} (Ruta: ${r.ruta}):`);
    console.log(r.cuerpo);
    console.log("------------------------");
  }

  // Find general history
  const histRes = await query(
    `SELECT creado_en, pregunta, respuesta, ia_provider, ia_sin_contexto, ia_provider_trace
     FROM historial_consultas 
     WHERE (usuario_id = $1 OR whatsapp LIKE $2 OR whatsapp LIKE $3)
     ORDER BY creado_en DESC LIMIT 3`,
    [user.id, `%2281419121%`, `%50225448284249%`]
  );
  
  console.log(`\n--- Historial Consultas (${histRes.rows.length}) ---`);
  const histReversed = [...histRes.rows].reverse();
  for (const r of histReversed) {
    console.log(`[${r.creado_en.toISOString()}] User: ${r.pregunta}`);
    console.log(`Bot: ${r.respuesta}`);
    console.log(`Provider: ${r.ia_provider} | Sin Contexto: ${r.ia_sin_contexto}`);
    console.log(`Trace:`, JSON.stringify(r.ia_provider_trace, null, 2));
    console.log("========================");
  }

  process.exit(0);
}

main().catch(console.error);
