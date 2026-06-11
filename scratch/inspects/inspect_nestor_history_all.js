"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const whatsapp = "5492494468949";
  
  const res = await query(
    `SELECT creado_en, pregunta, respuesta FROM historial_consultas 
     WHERE whatsapp LIKE $1 OR whatsapp LIKE $2
     ORDER BY creado_en DESC LIMIT 100`,
    [`%2494468949%`, `%2494468949%`]
  );
  
  console.log(`=== ALL HISTORIAL ENTRIES (${res.rows.length}) ===`);
  for (const r of res.rows) {
    console.log(`[${r.creado_en.toISOString()}] User: ${r.pregunta}`);
    console.log(`Bot: ${r.respuesta}\n`);
  }
  
  process.exit(0);
}

main().catch(console.error);
