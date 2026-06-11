"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const parts = ["2281419121", "2281", "419121"];
  
  console.log("=== SEARCHING RAW LOGS FOR PHONE PARTS ===");
  
  for (const part of parts) {
    const res = await query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta 
       FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm LIKE $1 OR cuerpo LIKE $1 
       ORDER BY creado_en DESC LIMIT 10`,
      [`%${part}%`]
    );
    
    if (res.rows.length > 0) {
      console.log(`\nFound ${res.rows.length} rows in whatsapp_interaccion_log matching "${part}":`);
      for (const r of res.rows) {
        console.log(`[${r.creado_en.toISOString()}] ${r.whatsapp_norm} (${r.direccion}):`);
        console.log(`Body: "${r.cuerpo.slice(0, 300)}"`);
        console.log(`User ID: ${r.usuario_id}, Route: ${r.ruta}`);
      }
      break;
    }
  }

  // Check queries in historial_consultas
  const hist = await query(
    `SELECT creado_en, whatsapp, pregunta, respuesta, usuario_id FROM historial_consultas 
     WHERE whatsapp LIKE '%2281419121%' OR pregunta LIKE '%2281419121%'
     ORDER BY creado_en DESC LIMIT 10`
  );
  if (hist.rows.length > 0) {
    console.log(`\nFound ${hist.rows.length} rows in "historial_consultas":`);
    for (const r of hist.rows) {
      console.log(`[${r.creado_en.toISOString()}] Phone: ${r.whatsapp}, User ID: ${r.usuario_id}`);
      console.log(`Q: ${r.pregunta}`);
      console.log(`A: ${r.respuesta}`);
    }
  }

  // Check phone in usuarios
  const users = await query(
    `SELECT id, nombre, whatsapp, whatsapp_real FROM usuarios 
     WHERE whatsapp LIKE '%2281419121%' OR whatsapp_real LIKE '%2281419121%'`
  );
  if (users.rows.length > 0) {
    console.log(`\nFound ${users.rows.length} rows in "usuarios":`);
    console.log(JSON.stringify(users.rows, null, 2));
  }
  
  process.exit(0);
}

main().catch(console.error);
