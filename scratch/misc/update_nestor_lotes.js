"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const lotesIds = [47, 48, 49]; // Lote 4, Lote 5, Lote 6
  const usuarioId = 538; // Néstor Palavecino
  
  console.log("=== UPDATING NESTOR'S LOTES ===");
  
  // Verify lotes exist first
  const checkRes = await query(
    `SELECT id, nombre, cliente, firma FROM lotes WHERE usuario_id = $1 AND id = ANY($2::int[])`,
    [usuarioId, lotesIds]
  );
  
  console.log("Current state of lotes:");
  console.log(JSON.stringify(checkRes.rows, null, 2));
  
  if (checkRes.rows.length === 0) {
    console.log("No lotes found with the specified IDs for Nestor");
    process.exit(1);
  }
  
  // Perform the update
  const updateRes = await query(
    `UPDATE lotes 
     SET cliente = 'San Jorge', firma = 'Néstor Palavecino' 
     WHERE usuario_id = $1 AND id = ANY($2::int[])`,
    [usuarioId, lotesIds]
  );
  
  console.log(`\nUpdated ${updateRes.rowCount} rows successfully.`);
  
  // Verify final state
  const verifyRes = await query(
    `SELECT id, nombre, cliente, firma FROM lotes WHERE usuario_id = $1 AND id = ANY($2::int[])`,
    [usuarioId, lotesIds]
  );
  
  console.log("\nVerified state after update:");
  console.log(JSON.stringify(verifyRes.rows, null, 2));
  
  process.exit(0);
}

main().catch(console.error);
