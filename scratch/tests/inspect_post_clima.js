"use strict";

require("dotenv").config();
const { query } = require("../../src/config/database");
const fs = require("fs");

async function main() {
  console.log("=== INSPECTING POST-CLIMA WHATSAPP LOGS ===");
  const targetNumber = "5492494468949";
  
  // Buscar todas las interacciones de este número después del clima (2026-06-05T12:30:00Z)
  try {
    const res = await query(
      `SELECT id, direccion, cuerpo, ruta, creado_en 
       FROM whatsapp_interaccion_log 
       WHERE (whatsapp_norm LIKE $1 OR whatsapp_norm LIKE $2)
         AND creado_en >= '2026-06-05T12:30:00Z'
       ORDER BY creado_en ASC`,
      [`%${targetNumber}%`, `%2494468949%`]
    );
    
    let out = `Found ${res.rows.length} records post-clima:\n\n`;
    for (const row of res.rows) {
      out += `[${row.creado_en.toISOString()}] [${row.direccion.toUpperCase()}] (Ruta: ${row.ruta || "N/A"}) ID: ${row.id}\n`;
      out += `Content: ${row.cuerpo}\n`;
      out += `--------------------------------------\n`;
    }
    
    fs.writeFileSync("scratch/tests/post_clima_chat.txt", out);
    console.log("Written log to scratch/tests/post_clima_chat.txt");
  } catch (err) {
    console.error("Error reading log:", err.message);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
