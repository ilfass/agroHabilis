"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const { procesarConsulta } = require("../../src/services/agent/pipeline/consulta_whatsapp");
const { query } = require("../../src/config/database");
const { limpiarEstado } = require("../../src/services/conversacion_estado");

const examples = [
  // 🐄 Carga de Hacienda
  {
    category: "Ganadería",
    label: "Registro básico",
    text: "registrá 120 novillos Angus en lote Norte"
  },
  {
    category: "Ganadería",
    label: "Múltiples categorías",
    text: "registrá 80 vacas y 45 terneros en lote Sur"
  },
  {
    category: "Ganadería",
    label: "Sin lote específico",
    text: "registrá 200 novillos en el establecimiento"
  },
  // 🌿 Estado de Pasturas
  {
    category: "Pasturas",
    label: "Consulta de pasturas",
    text: "¿cómo están las pasturas en el lote Sur?"
  },
  {
    category: "Pasturas",
    label: "Actualizar estado",
    text: "el potrero 4 ya tiene rebrote, tiene 3 semanas de descanso"
  },
  {
    category: "Pasturas",
    label: "Ingreso de animales",
    text: "ingresaron 80 novillos al lote Norte, empezó el pastoreo"
  },
  // 🌾 Cultivos y Siembra
  {
    category: "Agricultura",
    label: "Siembra básica",
    text: "sembré 80 ha de soja en lote La Elisa"
  },
  {
    category: "Agricultura",
    label: "Con variedad y densidad",
    text: "siembra de maíz DK7210 a 70.000 plantas/ha en 120 ha campo San Jorge"
  },
  {
    category: "Agricultura",
    label: "Múltiples lotes",
    text: "Lote 2b: 60 ha cebada\nLote 4: 100 ha trigo\nLote 6: 106 ha soja"
  },
  // 📦 Registro de Movimiento
  {
    category: "Movimientos",
    label: "Movimiento de ganado",
    text: "ingresaron 50 novillos Hereford al lote Norte, 320 kg promedio"
  },
  {
    category: "Movimientos",
    label: "Movimiento de grano",
    text: "tengo 350 tn de soja en el galpón Sur"
  },
  {
    category: "Movimientos",
    label: "Insumo recibido",
    text: "recibí 2000 litros de glifosato en el depósito"
  },
  // 🆕 Crear Lote por WhatsApp
  {
    category: "Estructura",
    label: "Crear lote nuevo",
    text: "crear lote \"Potrero Bajo\" de 95 ha"
  },
  {
    category: "Estructura",
    label: "Crear corral",
    text: "crear lote \"Corral 4\" de 2 ha"
  },
  {
    category: "Estructura",
    label: "Con más datos",
    text: "crear lote \"Lote Este\" de 180 ha"
  },
  // 📋 Trazabilidad Individual
  {
    category: "Caravanas",
    label: "Animal completo",
    text: "quiero registrar 1 ternero caravana AR-105 de raza Aberdeen Angus, peso 180 kg, sexo macho en el lote Bajo Grande"
  },
  {
    category: "Caravanas",
    label: "Vaca con datos",
    text: "tengo 1 vaca caravana AR-106 Hereford, preñada, 450 kg en el lote Norte"
  },
  {
    category: "Caravanas",
    label: "Consulta por caravana",
    text: "¿qué tiene la caravana AR-105?"
  },
  // 🩺 Eventos Sanitarios
  {
    category: "Eventos",
    label: "Vacunación grupal",
    text: "apliqué Clostal a todo el lote Norte hoy, 120 animales"
  },
  {
    category: "Eventos",
    label: "Tratamiento individual",
    text: "tratamiento antibiótico a la caravana AR-105 por neumonia, 5 días de carencia"
  },
  {
    category: "Eventos",
    label: "Pesaje",
    text: "pesaje lote Sur: promedio 380 kg en 60 novillos"
  },
  // 💸 Registro de Gastos
  {
    category: "Gastos",
    label: "Gasto de insumo",
    text: "GASTÉ $180.000 en herbicida glifosato para lote Norte"
  },
  {
    category: "Gastos",
    label: "Servicio contratado",
    text: "COMPRÉ $350.000 de flete para mover los novillos a la planta"
  },
  {
    category: "Gastos",
    label: "Gastos varios",
    text: "GASTÉ $95.000 en vacunas para el lote Sur"
  },
  // 💰 Registro de Ventas
  {
    category: "Ventas",
    label: "Venta de granos",
    text: "VENDÍ 80 tn de soja a $350.000 la tonelada"
  },
  {
    category: "Ventas",
    label: "Venta de hacienda",
    text: "VENDÍ 45 novillos a $1.200.000 en total en remate La Rural"
  },
  {
    category: "Ventas",
    label: "Venta directa",
    text: "VENDÍ 20 tn de trigo a $180.000 la tonelada al acopio Bunge"
  }
];

const testWa = "5492494468949";

async function clearUserState(userId) {
  // Clear conversation state
  await limpiarEstado(testWa);

  // Expire pending movements
  await query(
    `UPDATE inventario_movimiento 
     SET estado = 'expirado', rechazado_en = NOW() 
     WHERE usuario_id = $1 AND estado = 'pendiente_confirmacion'`,
    [userId]
  );
}

async function main() {
  console.log("=== STARTING AGENT VALIDATION TEST FOR ALL CLIENT WHATSAPP EXAMPLES ===");
  console.log(`Target Phone: ${testWa}`);

  // Resolve user profile to verify Néstor's ID
  const resUser = await query("SELECT id, nombre FROM usuarios WHERE whatsapp = $1 OR whatsapp_real = $1", [testWa]);
  if (resUser.rows.length === 0) {
    console.error("Test user not found in database!");
    process.exit(1);
  }
  const user = resUser.rows[0];
  console.log(`Found Test User: ${user.nombre} (ID: ${user.id})`);

  const results = [];
  const reportPath = path.join(__dirname, "../misc/whatsapp_examples_report.md");

  // Write initial report header
  fs.writeFileSync(
    reportPath,
    `# WhatsApp Examples Agent Test Report
- **Fecha**: ${new Date().toLocaleString()}
- **Productor**: ${user.nombre} (${testWa})
- **Total Casos**: ${examples.length}

| # | Categoría | Ejemplo | Mensaje Enviado | Respuesta del Agente | Estado |
|---|---|---|---|---|---|
`
  );

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    const caseNum = i + 1;
    console.log(`\n------------------------------------------------------------`);
    console.log(`[Case ${caseNum}/${examples.length}] [${ex.category} - ${ex.label}]`);
    console.log(`Input: "${ex.text.replace(/\n/g, "  ")}"`);

    // Baseline delay of 6s to prevent 429
    if (i > 0) {
      console.log("Waiting 6 seconds baseline delay to avoid rate limit...");
      await new Promise(r => setTimeout(r, 6000));
    }

    let gotResponse = "";
    let status = "✅ OK";
    let attempts = 0;
    const maxAttempts = 3;
    const startTime = Date.now();

    while (attempts < maxAttempts) {
      attempts++;
      // Clean state before running query
      await clearUserState(user.id);

      try {
        gotResponse = await procesarConsulta(testWa, ex.text);
        const cleanResp = String(gotResponse || "").trim();
        
        if (cleanResp.length < 5) {
          status = "❌ ERROR: Respuesta vacía o muy corta";
        } else if (
          cleanResp.toLowerCase().includes("demora técnica") ||
          cleanResp.toLowerCase().includes("error al procesar") ||
          cleanResp.toLowerCase().includes("estoy teniendo una demora")
        ) {
          status = "⚠️ WARNING: Posible fallo de API/Procesamiento (demora técnica)";
          if (attempts < maxAttempts) {
            console.log(`[Case ${caseNum}] Got fallback response, waiting 15 seconds to retry (Attempt ${attempts}/${maxAttempts})...`);
            await new Promise(r => setTimeout(r, 15000));
            continue;
          }
        } else {
          status = "✅ OK";
        }
        break; // Success or out of attempts
      } catch (err) {
        console.error(`[Case ${caseNum}] Error on attempt ${attempts}/${maxAttempts}:`, err.message);
        gotResponse = `[EXCEPCIÓN]: ${err.message}`;
        status = "❌ EXCEPTION";
        if (attempts < maxAttempts) {
          console.log(`Waiting 15 seconds to retry after exception...`);
          await new Promise(r => setTimeout(r, 15000));
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Response: ${gotResponse.slice(0, 160)}${gotResponse.length > 160 ? "..." : ""}`);
    console.log(`Status: ${status} (${duration}s)`);

    results.push({
      num: caseNum,
      category: ex.category,
      label: ex.label,
      text: ex.text,
      response: gotResponse,
      status,
      duration
    });

    // Write progress row to report
    const escapedText = ex.text.replace(/\n/g, "<br>");
    const escapedResponse = gotResponse.replace(/\n/g, "<br>").replace(/\|/g, "\\|");
    fs.appendFileSync(
      reportPath,
      `| ${caseNum} | ${ex.category} | ${ex.label} | ${escapedText} | ${escapedResponse} | ${status} (${duration}s) |\n`
    );
  }

  console.log(`\n============================================================`);
  console.log("=== TESTS COMPLETED ===");
  const passed = results.filter(r => r.status.startsWith("✅")).length;
  console.log(`Summary: ${passed}/${examples.length} PASSED`);
  console.log(`Detailed report written to: ${reportPath}`);

  // Append summary to report
  fs.appendFileSync(
    reportPath,
    `\n## Resumen de Ejecución\n- **Exitosos**: ${passed} / ${examples.length}\n- **Fallidos/Advertencias**: ${examples.length - passed}\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
