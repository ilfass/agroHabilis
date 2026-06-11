#!/usr/bin/env node
require("dotenv").config();

const { interpretarInventarioAgenteWhatsApp } = require("../src/services/inventario/nl_llm");

async function run() {
  console.log("=== Testing LLM Extraction of Advanced Parameters ===");
  
  const lotes = [
    { id: 1, nombre: "Corral 2" },
    { id: 2, nombre: "Lote 3" }
  ];
  const campanas = [];

  const cattleText = "Registrá un stock inicial de 45 novillos Angus de 380 kg de peso promedio en Corral 2 y aplicales Florfenicol con carencia de 30 días";
  const cropText = "Registrá una siembra de 120 ha de Soja Nidera 5009 lote de semilla madre AR-405, con 14% de humedad en el Lote 3. El lote es arrendado a un costo de 150 USD/ha";

  console.log(`\n1. Simulating Cattle WhatsApp: "${cattleText}"`);
  try {
    const cattleResult = await interpretarInventarioAgenteWhatsApp(cattleText, { lotes, campanas });
    console.log("CATTLE EXTRACTED:", JSON.stringify(cattleResult, null, 2));
  } catch (error) {
    console.error("Cattle Exception:", error);
  }

  console.log(`\n2. Simulating Crops WhatsApp: "${cropText}"`);
  try {
    const cropResult = await interpretarInventarioAgenteWhatsApp(cropText, { lotes, campanas });
    console.log("CROPS EXTRACTED:", JSON.stringify(cropResult, null, 2));
  } catch (error) {
    console.error("Crops Exception:", error);
  }
}

run();
