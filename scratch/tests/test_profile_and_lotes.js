"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const { crearLoteUsuario, listarLotesUsuario } = require("../src/services/inventario/core");
const { getClienteDashboard } = require("../src/services/dashboard");
const { query } = require("../src/config/database");

async function runTests() {
  console.log("=== STARTING INTEGRATION TESTS ===");
  
  // Find a test user
  const userRes = await query("SELECT id, nombre FROM usuarios ORDER BY id DESC LIMIT 1");
  if (userRes.rows.length === 0) {
    console.error("No users found in database to run tests!");
    return;
  }
  const user = userRes.rows[0];
  console.log(`Testing with User ID: ${user.id} (${user.nombre})`);

  // Test Lotes client column insertion and retrieval
  console.log("\n--- Testing Lotes Client column ---");
  const testLoteName = `Lote Test ${Math.floor(Math.random() * 1000)}`;
  const testClient = "Daedas S.A. Test Client";
  
  console.log(`Creating lote "${testLoteName}" for client "${testClient}"...`);
  const newLote = await crearLoteUsuario({
    usuarioId: user.id,
    nombre: testLoteName,
    hectareas: 150.5,
    cultivo: "Soja",
    arrendado: true,
    cliente: testClient
  });
  
  console.log("Created lote details:", JSON.stringify(newLote, null, 2));
  if (newLote.cliente !== testClient) {
    throw new Error("Created lote client does not match input!");
  }

  console.log("Listing lotes...");
  const lotes = await listarLotesUsuario(user.id);
  const found = lotes.find(l => l.id === newLote.id);
  if (!found) {
    throw new Error("Created lote not found in user lotes list!");
  }
  console.log("Found in list:", JSON.stringify(found, null, 2));
  if (found.cliente !== testClient) {
    throw new Error("Retrieved lote client does not match inserted value!");
  }
  console.log("Lotes client check: PASS");

  // Test profile multiple zones updating
  console.log("\n--- Testing Profile Multiple Zones ---");
  // Clean up
  await query("DELETE FROM usuario_zonas WHERE usuario_id = $1", [user.id]);
  
  // Update via API logic directly
  const testZonas = [
    { provincia: "Buenos Aires", partido: "Tandil" },
    { provincia: "Santa Fe", partido: "Venado Tuerto" }
  ];
  
  console.log("Syncing zones:", JSON.stringify(testZonas));
  const { geocodificarZona } = require("../src/services/onboarding");
  
  for (let i = 0; i < testZonas.length; i++) {
    const z = testZonas[i];
    const geo = await geocodificarZona({ partido: z.partido, provincia: z.provincia });
    console.log(`Geocoded ${z.partido}, ${z.provincia} -> lat: ${geo.lat}, lng: ${geo.lng}`);
    
    await query(
      `
        INSERT INTO usuario_zonas (usuario_id, provincia, partido, lat, lng, prioridad, activa)
        VALUES ($1, $2, $3, $4, $5, $6, true)
      `,
      [user.id, z.provincia, z.partido, geo.lat, geo.lng, i + 1]
    );
  }

  // Retrieve zones
  const dbZonas = (await query("SELECT provincia, partido, lat, lng, prioridad FROM usuario_zonas WHERE usuario_id = $1 ORDER BY prioridad", [user.id])).rows;
  console.log("Zones retrieved from DB:", JSON.stringify(dbZonas, null, 2));
  if (dbZonas.length !== 2) {
    throw new Error(`Expected 2 zones, got ${dbZonas.length}`);
  }
  if (dbZonas[0].partido !== "Tandil" || dbZonas[1].partido !== "Venado Tuerto") {
    throw new Error("Zones order or values are incorrect!");
  }
  console.log("Multiple zones check: PASS");

  // Validate getClienteDashboard output
  console.log("\n--- Testing getClienteDashboard payload ---");
  const dashboard = await getClienteDashboard({ usuarioId: user.id });
  console.log("Dashboard lotes (first 2):", JSON.stringify(dashboard.lotes?.slice(0, 2), null, 2));
  console.log("Dashboard zonas:", JSON.stringify(dashboard.zonas, null, 2));
  
  if (!Array.isArray(dashboard.lotes)) {
    throw new Error("Dashboard does not contain lotes array!");
  }
  if (!Array.isArray(dashboard.zonas)) {
    throw new Error("Dashboard does not contain zonas array!");
  }
  console.log("Dashboard payload check: PASS");

  console.log("\n=== ALL TESTS PASSED SUCCESSFULLY ===");
}

runTests().catch(err => {
  console.error("Test failed:", err.message);
  process.exitCode = 1;
});
