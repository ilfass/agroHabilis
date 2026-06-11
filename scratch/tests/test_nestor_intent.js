"use strict";

require("dotenv").config();
const { clasificarMensaje } = require("../../src/services/clasificador");
const { detectarIntencionIA } = require("../../src/services/intent_classifier");

async function main() {
  const msg = "me podes decir que tengo regstrado?";
  console.log("=== TESTING NESTOR INTENT CLASSIFICATION FOR:", msg, "===");

  // 1. Test detectarIntencionIA (used on incoming WhatsApp message)
  console.log("\n--- Running detectarIntencionIA (Gemini / LLM with post-LLM guardrail) ---");
  const resIntencion = await detectarIntencionIA(msg);
  console.log(JSON.stringify(resIntencion, null, 2));

  // 2. Test clasificarMensaje (used inside the background queue)
  console.log("\n--- Running clasificarMensaje (Legacy LLM classifier) ---");
  const resLegacy = await clasificarMensaje(msg, { id: 538, nombre: "Néstor Palavecino", cultivos: [], tiene_datos: true });
  console.log(JSON.stringify(resLegacy, null, 2));
}

main().catch(console.error);
