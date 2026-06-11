"use strict";

require("dotenv").config();
const { clasificarHeuristica, clasificarMensaje } = require("../src/services/clasificador");

async function main() {
  const text = `[Análisis de archivo: Plano catastral y productivo del establecimiento 'Don Martín'. Ubicación: Lat 37°18'55.67"S / Long 59°48'31.31"O, Partido de Benito Juárez. Medición de precisión con GPS Geodésic`;
  
  console.log("=== RUNNING HEURISTIC CLASSIFIER ===");
  const cl = clasificarHeuristica(text);
  console.log("Heuristic result:", JSON.stringify(cl, null, 2));
  
  console.log("\n=== RUNNING MAIN LLM CLASSIFIER ===");
  const clMsg = await clasificarMensaje(text, { id: 575, nombre: "Juan Barreiro", plan: "pro_max" });
  console.log("LLM Classifier result:", JSON.stringify(clMsg, null, 2));

  // Also run full IA turn logic to see if it bypasses or what
  const { ejecutarToolFirstTurn } = require("../src/services/agent/ia/tool_first_turn");
  console.log("\n=== RUNNING TOOL-FIRST TURN LOOP ===");
  const res = await ejecutarToolFirstTurn({
    mensaje: text,
    usuario: { id: 575, nombre: "Juan Barreiro", plan: "pro_max" },
    numeroWhatsapp: "50225448284249"
  });
  console.log("IA result text:", res.texto);
  console.log("Tool trace:", JSON.stringify(res.toolTrace, null, 2));
  
  process.exit(0);
}

main().catch(console.error);

