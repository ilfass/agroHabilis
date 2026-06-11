"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const whatsapp = "5492494468949";
  console.log("=== CHECKING HISTORIAL_CONSULTAS FOR:", whatsapp, "===");

  const res = await query(
    `SELECT id, creado_en, pregunta, respuesta, ia_provider 
     FROM historial_consultas 
     WHERE whatsapp = $1 OR whatsapp LIKE $2
     ORDER BY creado_en DESC 
     LIMIT 20`,
    [whatsapp, `%${whatsapp.slice(-10)}%`]
  );
  
  res.rows.forEach(row => {
    console.log(`\n--- ID: ${row.id} | ${row.creado_en.toISOString()} | Provider: ${row.ia_provider} ---`);
    console.log(`Q: "${row.pregunta.replace(/\n/g, ' ')}"`);
    console.log(`A: "${row.respuesta.substring(0, 100).replace(/\n/g, ' ')}..."`);
  });
}

main().catch(console.error);
