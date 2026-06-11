"use strict";

require("dotenv").config();
const { ejecutarToolFirstTurn } = require("../src/services/agent/ia/tool_first_turn");

async function runTest() {
  const usuario = {
    id: 575,
    nombre: "Juan Barreiro",
    plan: "pro",
    cultivos: []
  };

  const mensaje = "cargame el Lote 1 y Lote 2 en Don Martín de la firma Daedaz";

  console.log("=== SIMULATING HIERARCHICAL LOTE REGISTRATION ===");
  console.log(`User message: "${mensaje}"`);
  console.log("Running tool-first turn loop...");

  const res = await ejecutarToolFirstTurn({
    mensaje,
    usuario,
    historialReciente: []
  });

  console.log("\n=== RESULT ===");
  console.log("Assistant response text:", res.texto);
  console.log("Tool trace:", JSON.stringify(res.toolTrace, null, 2));
  console.log("Domain tool used:", res.domainToolUsed);
  process.exit(0);
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
