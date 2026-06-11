"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const whatsapp = "5492494468949";
  
  // Find user
  const userRes = await query(
    `SELECT * FROM usuarios WHERE whatsapp LIKE $1 OR whatsapp_real LIKE $1`,
    [`%2494468949%`]
  );
  
  if (userRes.rows.length === 0) {
    console.log("No user found with phone 2494468949");
    process.exit(0);
  }
  
  const user = userRes.rows[0];
  console.log("=== USER DETAILS ===");
  console.log("ID:", user.id);
  console.log("Nombre:", user.nombre);
  console.log("Plan:", user.plan);
  console.log("Localidad:", user.localidad);
  console.log("Provincia:", user.provincia);
  console.log("Partido:", user.partido);
  
  // Find lotes
  const lotesRes = await query(
    `SELECT id, nombre, cliente, firma, creado_en FROM lotes WHERE usuario_id = $1 ORDER BY id DESC`,
    [user.id]
  );
  
  console.log("\n=== LOTES ===");
  console.log(`Found ${lotesRes.rows.length} lotes:`);
  console.table(lotesRes.rows);
  
  process.exit(0);
}

main().catch(console.error);
