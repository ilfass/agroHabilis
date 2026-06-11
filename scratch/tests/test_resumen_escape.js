"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { query } = require("../../src/config/database");
const { 
  mensajeTieneIntencionFueraDelFlujoResumen, 
  procesarRespuestaResumen 
} = require("../../src/services/resumen_interactivo");
const { guardarEstado, obtenerEstado, limpiarEstado } = require("../../src/services/conversacion_estado");

async function main() {
  console.log("==================================================");
  console.log("🧪 TESTING RESUMEN INTERACTIVO ESCAPE MECHANISM");
  console.log("==================================================\n");

  const testWa = "5492494468949"; // Test WhatsApp number
  const testMsg = "listame campos y lotes";

  // 1. Find the test user in the database (Nestor or another user)
  const userCheck = await query(
    "SELECT id, nombre, whatsapp FROM usuarios WHERE id = 538 OR whatsapp = $1 LIMIT 1",
    [testWa]
  );
  
  if (!userCheck.rows.length) {
    console.warn("⚠️ Warning: User with ID 538 or WhatsApp 5492494468949 not found in DB. Using fallback mock.");
  }
  const user = userCheck.rows[0] || { id: 999, nombre: "Test User", whatsapp: testWa };
  console.log(`👤 Test User: ${user.nombre} (ID: ${user.id}, WA: ${user.whatsapp})`);

  // 2. Test mensajeTieneIntencionFueraDelFlujoResumen
  console.log(`\n1. Testing intent detection for: "${testMsg}"`);
  const isOutOfFlow = await mensajeTieneIntencionFueraDelFlujoResumen(testMsg, user);
  console.log(`   - Is out of flow? ${isOutOfFlow ? "✅ YES (Escape)" : "❌ NO (Stay)"}`);
  if (!isOutOfFlow) {
    console.error("❌ Test Failed: 'listame campos y lotes' should trigger escape.");
    process.exit(1);
  }

  // 3. Test conversational state transition
  console.log("\n2. Testing state transition in procesarRespuestaResumen...");
  
  // Set initial state to 'resumen_interactivo' / 'esperando_confirmacion'
  await guardarEstado(
    testWa,
    "resumen_interactivo",
    "esperando_confirmacion",
    { usuario_id: user.id },
    1
  );

  console.log("   - Initial state set to 'resumen_interactivo' / 'esperando_confirmacion'");
  const initialState = await obtenerEstado(testWa);
  console.log("   - Confirmed initial state:", JSON.stringify(initialState));

  // Call procesarRespuestaResumen
  let sentMessage = "";
  const mockEnviar = async (txt) => {
    sentMessage = txt;
    console.log(`   - Mock Bot sent message: "${txt.replace(/\n/g, " ")}"`);
  };

  const wasHandled = await procesarRespuestaResumen({
    whatsapp: testWa,
    mensaje: testMsg,
    enviar: mockEnviar
  });

  console.log(`   - Was message handled inside the summary flow? ${wasHandled ? "❌ YES" : "✅ NO (Escaped)"}`);
  
  const finalState = await obtenerEstado(testWa);
  console.log(`   - Final state in DB: ${finalState ? JSON.stringify(finalState) : "null (Cleared)"}`);

  if (!wasHandled && !finalState && sentMessage.includes("Pauso el resumen")) {
    console.log("\n✅ SUCCESS: Flow successfully escaped, state cleared, and pause message sent.");
  } else {
    console.error("\n❌ Test Failed: State was not cleared or wrong response sent.");
    process.exit(1);
  }

  // Clean up
  await limpiarEstado(testWa);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
