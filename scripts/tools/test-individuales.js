#!/usr/bin/env node
require("dotenv").config();

const { interpretarInventarioAgenteWhatsApp } = require("../../src/services/inventario/nl_llm");

async function run() {
  console.log("=== Debugging Real Function ===");
  const lotes = [{ id: 1, nombre: "Bajo Grande" }];
  const campanas = [];
  const text = "quiero registrar 1 ternero caravana AR-105 de raza Aberdeen Angus, peso 180 kilos y sexo macho en el lote Bajo Grande";

  try {
    const result = await interpretarInventarioAgenteWhatsApp(text, { lotes, campanas });
    console.log("RESULT:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("EXCEPTION:", error);
  }
}

run();
