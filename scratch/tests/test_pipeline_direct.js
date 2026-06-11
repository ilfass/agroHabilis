"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const { registroConfirmadoDirecto } = require("../src/services/inventario/core");
const { getClienteDashboard } = require("../src/services/dashboard");

async function main() {
  const connStr = process.env.DATABASE_URL;
  console.log("Using Database URL:", connStr);
  const pool = new Pool({ connectionString: connStr });

  // Patch database service to use our pool
  const db = require("../src/config/database");
  db.query = (text, params) => pool.query(text, params);

  const userId = 521; // Roberto

  try {
    // 1. Fetch Roberto's lotes
    console.log("=== Fetching Roberto's Lotes ===");
    const resLotes = await pool.query("SELECT id, nombre, cultivo, arrendado FROM lotes WHERE usuario_id = $1 LIMIT 2", [userId]);
    console.log("Lotes:", resLotes.rows);

    if (resLotes.rows.length === 0) {
      console.log("Roberto has no lotes. Creating one...");
      const insertLote = await pool.query(
        "INSERT INTO lotes (usuario_id, nombre, hectareas, creado_en) VALUES ($1, 'Lote Test 1', 100, NOW()) RETURNING id, nombre",
        [userId]
      );
      resLotes.rows.push(insertLote.rows[0]);
    }

    const loteId = resLotes.rows[0].id;
    console.log("Using Lote ID:", loteId);

    // 2. Insert Confirmed Ganado Movement with Raza, average weight, sanidad, carencia
    console.log("\n=== Registering Confirmed Ganado Movement ===");
    const ganadoPayload = {
      especie: "vacuno",
      categoria: "novillito",
      cantidad: 30,
      raza: "Braford",
      peso_promedio: 320,
      sanidad_tratamiento: "Florfenicol 30%",
      dias_carencia: 28
    };

    const ganadoMov = await registroConfirmadoDirecto({
      usuarioId: userId,
      dominio: "ganado",
      payload: ganadoPayload,
      loteId,
      efecto: "replace",
      textoNl: "Registrar stock de 30 novillitos Braford...",
      fechaReferencia: "2026-05-28"
    });
    console.log("Ganado Movement Created ID:", ganadoMov.id);

    // 3. Insert Confirmed Crop Movement with lote_semilla, humedad, arrendado, costo_arrendamiento
    console.log("\n=== Registering Confirmed Crop Movement ===");
    const cropPayload = {
      cultivo: "Maíz",
      hectareas: 80,
      variedad: "DK72-10",
      fecha_siembra: "2026-05-28",
      densidad: 7.5,
      rinde_esperado: 9.5,
      lote_semilla: "DK-MAIZ-789",
      humedad: 13.5,
      arrendado: true,
      costo_arrendamiento: 180
    };

    const cropMov = await registroConfirmadoDirecto({
      usuarioId: userId,
      dominio: "cultivo",
      payload: cropPayload,
      loteId,
      efecto: "replace",
      textoNl: "Registrar siembra de Maíz...",
      fechaReferencia: "2026-05-28"
    });
    console.log("Crop Movement Created ID:", cropMov.id);

    // 4. Query Cliente Dashboard
    console.log("\n=== Fetching Dashboard to Verify JOIN & Payload Parsing ===");
    const dashboardData = await getClienteDashboard({ usuarioId: userId });

    console.log("\n=== GANADERIA PERFIL IN DASHBOARD ===");
    const filterGanado = dashboardData.ganaderiaPerfil.filter(g => g.categoria === "novillito");
    console.log(JSON.stringify(filterGanado, null, 2));

    console.log("\n=== CULTIVOS IN DASHBOARD ===");
    const filterCultivos = dashboardData.cultivos.filter(c => c.lote_nombre === resLotes.rows[0].nombre);
    console.log(JSON.stringify(filterCultivos, null, 2));

    // Assert that fields are correctly extracted
    let cattleSuccess = false;
    let cropSuccess = false;

    if (filterGanado.length > 0 && 
        filterGanado[0].raza === "Braford" && 
        Number(filterGanado[0].peso_promedio) === 320 && 
        filterGanado[0].sanidad_tratamiento === "Florfenicol 30%" && 
        Number(filterGanado[0].dias_carencia) === 28) {
      console.log("\n✅ SUCCESS: Cattle advanced fields extracted perfectly from JOIN payload!");
      cattleSuccess = true;
    } else {
      console.error("\n❌ FAILURE: Cattle advanced fields missing or incorrect!", filterGanado);
    }

    if (filterCultivos.length > 0 && 
        filterCultivos[0].lote_semilla === "DK-MAIZ-789" && 
        Number(filterCultivos[0].costo_arrendamiento) === 180 && 
        filterCultivos[0].arrendado === true) {
      console.log("✅ SUCCESS: Crop advanced fields and lease cost extracted perfectly from JOIN payload!");
      cropSuccess = true;
    } else {
      console.error("❌ FAILURE: Crop advanced fields missing or incorrect!", filterCultivos);
    }

    if (cattleSuccess && cropSuccess) {
      console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY!");
    } else {
      process.exit(1);
    }

  } catch (err) {
    console.error("Error in direct integration test:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
