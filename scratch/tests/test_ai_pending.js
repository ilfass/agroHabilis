"use strict";

require("dotenv").config();
const { clasificarIntencionBorradorPendiente } = require("../src/services/turn_handlers/inventario_pendiente");

async function test() {
  const descBorrador = "500 vacas negras en lote el rodeo";
  
  const testCases = [
    { input: "sí, guardalo", expected: "confirmar" },
    { input: "dale de una", expected: "confirmar" },
    { input: "no", expected: "cancelar" },
    { input: "cancelar", expected: "cancelar" },
    { input: "olvidate de eso", expected: "cancelar" },
    { input: "son 150 ha", expected: "completar_datos" },
    { input: "pesan 320 kg promedio", expected: "comentario_adicional" },
    { input: "Registrar campo amor, las luces y el umbral", expected: "cambiar_tema" },
    { input: "cuánto está la soja hoy?", expected: "cambiar_tema" },
    { input: "crear el lote norte", expected: "cambiar_tema" }
  ];

  console.log(`=== TESTING AI INTENT CLASSIFICATION ===`);
  console.log(`Borrador pendiente: "${descBorrador}"\n`);

  for (const tc of testCases) {
    const res = await clasificarIntencionBorradorPendiente(tc.input, descBorrador);
    console.log(`Input: "${tc.input}"`);
    console.log(`Result: "${res}" | Expected: "${tc.expected}"`);
    console.log(res === tc.expected ? "✅ MATCH" : "❌ MISMATCH");
    console.log(`-----------------------------------`);
  }
}

test().catch(console.error);
