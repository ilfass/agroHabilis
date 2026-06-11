"use strict";

const { detectarIntencionIA } = require("../../src/services/intent_classifier");
const { mensajeTieneIntencionFueraDelFlujoResumen } = require("../../src/services/resumen_interactivo");

async function main() {
  console.log("--- TEST 1: me podes decir que tengo regstrado? ---");
  const query1 = "me podes decir que tengo regstrado?";
  try {
    const intencionIA = await detectarIntencionIA(query1);
    console.log("detectarIntencionIA result:", JSON.stringify(intencionIA, null, 2));
    const isMiResumen = intencionIA.tipo === "comando" && intencionIA.comando === "MI_RESUMEN";
    console.log("Is classified as MI_RESUMEN?", isMiResumen ? "❌ FAIL (Still misclassified)" : "✅ PASS (Correctly bypassed/not MI_RESUMEN)");
  } catch (e) {
    console.error("Test 1 error:", e.message);
  }

  console.log("\n--- TEST 2: Out of flow check for 'y cual es mi plan actual' ---");
  const query2 = "y cual es mi plan actual";
  const outOfFlow = await mensajeTieneIntencionFueraDelFlujoResumen(query2);
  console.log("Query:", query2);
  console.log("Exits resumen interactivo flow?", outOfFlow ? "✅ PASS (Exits correctly)" : "❌ FAIL (Stays in flow)");
  
  console.log("\n--- TEST 3: Out of flow check for 'me podes decir que tengo regstrado?' ---");
  const outOfFlow3 = await mensajeTieneIntencionFueraDelFlujoResumen(query1);
  console.log("Query:", query1);
  console.log("Exits resumen interactivo flow?", outOfFlow3 ? "✅ PASS (Exits correctly)" : "❌ FAIL (Stays in flow)");

  process.exit(0);
}

main().catch(console.error);
