#!/usr/bin/env node
require("dotenv").config();

const { getClienteDashboard } = require("../src/services/dashboard");

async function run() {
  console.log("=== Testing Dashboard Endpoint and Database Extraction ===");
  const userId = 521; // Roberto ID

  try {
    const result = await getClienteDashboard({ usuarioId: userId });
    
    console.log("\n=== Carga Ganadera Encontrada ===");
    console.log(JSON.stringify(result.ganaderiaPerfil, null, 2));

    console.log("\n=== Cultivos Encontrados ===");
    console.log(JSON.stringify(result.cultivos, null, 2));
    
  } catch (error) {
    console.error("Dashboard test failed:", error);
  }
}

run();
