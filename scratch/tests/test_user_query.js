"use strict";

require("dotenv").config();
const { detectarIntencionIA } = require("../src/services/intent_classifier");
const { clasificarMensaje } = require("../src/services/clasificador");

async function main() {
  const queryText = "me podes decir que tengo regstrado?";
  console.log("Query:", queryText);
  try {
    const intencionIA = await detectarIntencionIA(queryText);
    console.log("detectarIntencionIA result:", JSON.stringify(intencionIA, null, 2));
  } catch (e) {
    console.error("detectarIntencionIA error:", e.message);
  }

  try {
    const c = await clasificarMensaje(queryText, { cultivos: [] });
    console.log("clasificarMensaje result:", JSON.stringify(c, null, 2));
  } catch (e) {
    console.error("clasificarMensaje error:", e.message);
  }
}

main().catch(console.error);
