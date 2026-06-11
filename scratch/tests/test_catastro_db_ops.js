"use strict";

require("dotenv").config();
const { query } = require("../../src/config/database");
const { crearLoteUsuario, listarLotesUsuario } = require("../../src/services/inventario/core");

async function runTests() {
  console.log("=== STARTING CATASTRO DB OPS INTEGRATION TESTS ===");
  
  // Find a test user
  const userRes = await query("SELECT id, nombre FROM usuarios ORDER BY id DESC LIMIT 1");
  if (userRes.rows.length === 0) {
    console.error("No users found in database to run tests!");
    return;
  }
  const user = userRes.rows[0];
  console.log(`Testing with User ID: ${user.id} (${user.nombre})`);

  // 1. Create a lot with coordinates lat, lng, firma, and cliente
  console.log("\n--- 1. Testing Lote creation with coordinates & hierarchy ---");
  const testLoteName = `Lote Catastro Test ${Math.floor(Math.random() * 1000)}`;
  const testFirma = "Firma A AgroTest";
  const testCliente = "Establecimiento El Sol Test";
  const testLat = -34.6037;
  const testLng = -58.3816;

  console.log(`Creating lote: "${testLoteName}" under firma: "${testFirma}", campo: "${testCliente}" with coords: [${testLat}, ${testLng}]`);
  
  const createdLote = await crearLoteUsuario({
    usuarioId: user.id,
    nombre: testLoteName,
    hectareas: 120.5,
    cultivo: "Maíz",
    arrendado: false,
    cliente: testCliente,
    firma: testFirma,
    tipo: "lote",
    lat: testLat,
    lng: testLng
  });

  console.log("Created Lote details:", JSON.stringify(createdLote, null, 2));
  
  if (Number(createdLote.lat) !== testLat || Number(createdLote.lng) !== testLng) {
    throw new Error("Created lote latitude or longitude does not match input!");
  }
  if (createdLote.firma !== testFirma || createdLote.cliente !== testCliente) {
    throw new Error("Created lote firma or cliente does not match input!");
  }
  console.log("Lote creation with coords check: PASS");

  // 2. Test renaming a firma globally for this user
  console.log("\n--- 2. Testing rename firma globally ---");
  const newFirmaName = "Firma A AgroTest RENAMED";
  console.log(`Renaming firma "${testFirma}" to "${newFirmaName}"...`);
  
  await query(
    "UPDATE lotes SET firma = $1 WHERE usuario_id = $2 AND (firma = $3 OR (firma IS NULL AND $3 = ''))",
    [newFirmaName, user.id, testFirma]
  );

  // Fetch from database to verify
  const checkLoteFirma = await query("SELECT id, nombre, firma, cliente FROM lotes WHERE id = $1", [createdLote.id]);
  console.log("Updated Lote details after renaming firma:", JSON.stringify(checkLoteFirma.rows[0], null, 2));
  if (checkLoteFirma.rows[0].firma !== newFirmaName) {
    throw new Error("Firma was not updated successfully!");
  }
  console.log("Rename firma globally check: PASS");

  // 3. Test renaming a campo (cliente) globally for this user
  console.log("\n--- 3. Testing rename campo (cliente) globally ---");
  const newClienteName = "Establecimiento El Sol Test RENAMED";
  console.log(`Renaming campo "${testCliente}" to "${newClienteName}"...`);
  
  await query(
    "UPDATE lotes SET cliente = $1 WHERE usuario_id = $2 AND (cliente = $3 OR (cliente IS NULL AND $3 = ''))",
    [newClienteName, user.id, testCliente]
  );

  // Fetch from database to verify
  const checkLoteCampo = await query("SELECT id, nombre, firma, cliente FROM lotes WHERE id = $1", [createdLote.id]);
  console.log("Updated Lote details after renaming campo:", JSON.stringify(checkLoteCampo.rows[0], null, 2));
  if (checkLoteCampo.rows[0].cliente !== newClienteName) {
    throw new Error("Campo/Cliente was not updated successfully!");
  }
  console.log("Rename campo globally check: PASS");

  // 4. Test deleting/dissociating firma globally
  console.log("\n--- 4. Testing dissociate/delete firma globally ---");
  console.log(`Dissociating/setting firma = NULL for "${newFirmaName}"...`);
  await query(
    "UPDATE lotes SET firma = NULL WHERE usuario_id = $1 AND (firma = $2 OR (firma IS NULL AND $2 = ''))",
    [user.id, newFirmaName]
  );
  
  const checkLoteFirmaDel = await query("SELECT id, nombre, firma FROM lotes WHERE id = $1", [createdLote.id]);
  console.log("Updated Lote details after deleting/dissociating firma:", JSON.stringify(checkLoteFirmaDel.rows[0], null, 2));
  if (checkLoteFirmaDel.rows[0].firma !== null) {
    throw new Error("Firma was not set to NULL!");
  }
  console.log("Dissociate/delete firma check: PASS");

  // 5. Test deleting/dissociating campo globally
  console.log("\n--- 5. Testing dissociate/delete campo globally ---");
  console.log(`Dissociating/setting cliente = NULL for "${newClienteName}"...`);
  await query(
    "UPDATE lotes SET cliente = NULL WHERE usuario_id = $1 AND (cliente = $2 OR (cliente IS NULL AND $2 = ''))",
    [user.id, newClienteName]
  );
  
  const checkLoteCampoDel = await query("SELECT id, nombre, cliente FROM lotes WHERE id = $1", [createdLote.id]);
  console.log("Updated Lote details after deleting/dissociating campo:", JSON.stringify(checkLoteCampoDel.rows[0], null, 2));
  if (checkLoteCampoDel.rows[0].cliente !== null) {
    throw new Error("Cliente was not set to NULL!");
  }
  console.log("Dissociate/delete campo check: PASS");

  // 6. Clean up test lote
  console.log("\n--- 6. Cleaning up test lote ---");
  await query("DELETE FROM lotes WHERE id = $1", [createdLote.id]);
  console.log("Test lote cleaned up.");

  console.log("\n=== ALL CATASTRO DB INTEGRATION TESTS PASSED SUCCESSFULLY ===");
}

runTests().catch(err => {
  console.error("Test failed:", err.message);
  process.exitCode = 1;
});
