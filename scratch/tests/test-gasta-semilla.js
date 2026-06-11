"use strict";

require("dotenv").config();
const { detectarIntencionIA } = require("../src/services/intent_classifier");
const { registrarGasto } = require("../src/services/gastos");
const { query, pool } = require("../src/config/database");

async function main() {
  console.log("=== TESTING 'gasta 250000 en semilla maiz' ===");
  const consulta = "gasta 250000 en semilla maiz";

  // Mock usuario Pro de Fabian (id: 487)
  const mockUsuario = {
    id: 487,
    nombre: "fabian de haro",
    es_delegado: true,
    nombre_operario: "Diego Figueroa",
    rol_operario: "encargado"
  };

  try {
    // 1. Test Intent Classification
    const intencion = await detectarIntencionIA(consulta);
    console.log("\n[1. CLASIFICACION DE INTENCION]:", intencion);

    // 2. Clear old test registers
    await query("DELETE FROM gastos WHERE usuario_id = $1 AND descripcion LIKE '%semilla maiz%'", [mockUsuario.id]);

    // 3. Test Gasto Register
    console.log("\n[2. REGISTRANDO GASTO...]");
    const replyText = await registrarGasto(mockUsuario, consulta);
    console.log("[RESPUESTA SISTEMA]:", replyText);

    // 4. Verify in DB
    const dbRecord = await query(
      "SELECT * FROM gastos WHERE usuario_id = $1 AND descripcion LIKE '%semilla maiz%' ORDER BY id DESC LIMIT 1",
      [mockUsuario.id]
    );
    
    console.log("\n[3. VERIFICACION EN BASE DE DATOS]:");
    if (dbRecord.rows.length > 0) {
      console.log("✅ SUCCESS: Gasto guardado con éxito!");
      console.log(dbRecord.rows[0]);
    } else {
      console.log("❌ FAILURE: No se encontró el registro en la base de datos.");
    }

    // Clean up
    await query("DELETE FROM gastos WHERE usuario_id = $1 AND descripcion LIKE '%semilla maiz%'", [mockUsuario.id]);

  } catch (e) {
    console.error("Error:", e);
  } finally {
    await pool.end();
  }
}

main();
