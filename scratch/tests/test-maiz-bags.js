"use strict";

require("dotenv").config();
const { detectarIntencionIA } = require("../src/services/intent_classifier");
const { pool } = require("../src/config/database");

async function main() {
  console.log("=== TESTING INTENT FOR 'Registrá entrada de 10 bolsas de maiz' ===");
  const consulta = "Registrá entrada de 10 bolsas de maiz";
  
  try {
    const intencion = await detectarIntencionIA(consulta);
    console.log("[RESULTADO CLASIFICACION]:", intencion);
    
    if (intencion.tipo === "consulta_libre" && intencion.comando === null) {
      console.log("✅ SUCCESS: Clasificado correctamente como consulta_libre, evitando el desvío a CMD_GASTO!");
    } else {
      console.log("❌ FAILURE: Se sigue desviando a otra intención o comando!");
    }
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await pool.end();
  }
}

main();
