"use strict";

require("dotenv").config();
const { ejecutarToolFirstTurn } = require("../src/services/agent/ia/tool_first_turn");

async function main() {
  const usuario = {
    id: 575,
    nombre: "Juan Barreiro",
    plan: "pro_max",
    cultivos: []
  };

  const assistantPreviousMsg = `Analicé la foto del plano catastral y productivo del establecimiento *Don Martín* (Benito Juárez) que me mandaste. Logré extraer la siguiente lista de potreros/lotes y sus superficies correspondientes:

📋 *Detalle de Lotes y Superficies:*
• *Lote 1:* Potrero: 15.75 ha | Agrícola: 15.43 ha
• *Lote 1 Calle:* Potrero: 0.77 ha | Agrícola: 0.00 ha
• *Lote 2a:* Potrero: 2.85 ha | Agrícola: 0.00 ha
• *Lote 2b:* Potrero: 52.14 ha | Agrícola: 51.24 ha
• *Lote 2b Piq:* Potrero: 0.01 ha | Agrícola: 0.00 ha
• *Lote 3:* Potrero: 31.89 ha | Agrícola: 31.02 ha

¿Querés que agreguemos todos estos lotes y sus superficies de potrero (ha) al sistema bajo el establecimiento *Don Martín* para la firma *Daedaz Sociedad Anónima*? Confirmame con un "Sí" y los doy de alta automáticamente. 👍`;

  const historialReciente = [
    {
      pregunta: "[Análisis de archivo: Plano catastral y productivo del establecimiento 'Don Martín'...]",
      respuesta: assistantPreviousMsg
    }
  ];

  const mensaje = "Sí, dale, cargalos todos";

  console.log("=== SIMULATING JUAN CONFIRMATION ===");
  console.log("User message:", mensaje);
  console.log("Running tool-first turn loop...");

  try {
    const res = await ejecutarToolFirstTurn({
      mensaje,
      usuario,
      historialReciente
    });

    console.log("\n=== RESULT ===");
    console.log("Assistant Response Text:", res.texto);
    console.log("Tool Trace:", JSON.stringify(res.toolTrace, null, 2));
    console.log("Domain Tool Used:", res.domainToolUsed);
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

main();
