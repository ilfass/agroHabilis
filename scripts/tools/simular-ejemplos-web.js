#!/usr/bin/env node
/**
 * Prueba en lote de los ejemplos reales publicados en la web/landing page
 * de AgroHabilis para verificar el formato de las respuestas del Agente.
 */
require("dotenv").config();

const { query, pool } = require("../../src/config/database");
const { normalizarWhatsapp } = require("../../src/models/usuario");
const { gestionarOnboarding } = require("../../src/services/onboarding");
const { procesarConsulta } = require("../../src/services/agent/pipeline/consulta_whatsapp");

const TEST_WA = "5491199820999";

// Secuencia de los 5 casos de la web
const CASOS = [
  {
    nombre: "1. SANIDAD ANIMAL Y CARENCIA (Novillo Neumonía)",
    inputs: [
      "tengo 1 ternero caravana AR-105 de raza Aberdeen Angus tratado con antibiotico por neumonia en el lote Bajo Grande",
      "SI"
    ]
  },
  {
    nombre: "2. AGRICULTURA - FERTILIZACIÓN (Urea Trigo)",
    inputs: [
      "registra aplicacion de 120 kg/ha de urea en el Lote Norte para el trigo",
      "SI"
    ]
  },
  {
    nombre: "3. AGRICULTURA - COSECHA (Soja Lote 5)",
    inputs: [
      "tengo 120 tn de soja cosechada en el Lote 5 a 14% de humedad"
    ]
  },
  {
    nombre: "4. ALERTA DE PRECIO (Soja Rosario)",
    inputs: [
      "avisame cuando la soja Rosario supere los USD 310"
    ]
  },
  {
    nombre: "5. DECISIÓN DE VENTA Y PERSPECTIVA (Venta Mayo vs Julio)",
    inputs: [
      "tengo soja en silo, me conviene vender ahora en mayo o esperar a julio?"
    ]
  }
];

async function limpiarTest(waNorm) {
  await query(`DELETE FROM whatsapp_interaccion_log WHERE whatsapp_norm = $1`, [waNorm]);
  await query(`DELETE FROM historial_consultas WHERE whatsapp = $1`, [waNorm]);
  await query(`DELETE FROM onboarding_estado WHERE whatsapp = $1`, [waNorm]);
  const u = await query(`SELECT id FROM usuarios WHERE whatsapp = $1`, [waNorm]);
  const id = u.rows[0]?.id;
  if (id) {
    await query(`DELETE FROM stock_ganadero WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM animales_individuales WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM usuario_ganaderia_perfil WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM perfil_productivo WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM usuario_cultivos WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM usuario_zonas WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM usuarios WHERE id = $1`, [id]);
  }
}

async function simularOnboardingMinimo(wa) {
  // Inicializa el usuario de prueba ya registrado en Tandil
  await gestionarOnboarding(wa, "Hola");
  await gestionarOnboarding(wa, "Test Web");
  await gestionarOnboarding(wa, "Buenos Aires, Tandil");
  await gestionarOnboarding(wa, "soja, maiz y ganaderia");
  await gestionarOnboarding(wa, "vacuno novillos");
}

async function main() {
  const wa = normalizarWhatsapp(TEST_WA);
  console.log(`\n=============================================================`);
  console.log(`🚀 TEST COMPARATIVO DE EJEMPLOS WEB DE AGROHABILIS`);
  console.log(`=============================================================\n`);

  console.log(`🧹 Limpiando base de datos para la prueba...`);
  await limpiarTest(wa);
  await simularOnboardingMinimo(wa);
  console.log(`✅ Entorno de onboarding simulado listo en Tandil.\n`);

  for (const caso of CASOS) {
    console.log(`\n🎯 EJEMPLO: ${caso.nombre}`);
    console.log(`=============================================================`);
    
    for (const input of caso.inputs) {
      console.log(`👤 [Usuario]: "${input}"`);
      try {
        const respuesta = await procesarConsulta(wa, input);
        console.log(`🤖 [Agente]:`);
        console.log(`-------------------------------------------------------------`);
        console.log(respuesta);
        console.log(`-------------------------------------------------------------\n`);
      } catch (e) {
        console.error(`❌ Error al procesar turno:`, e.message || e);
      }
    }
  }

  console.log(`🧹 Limpiando registros de prueba finales...`);
  await limpiarTest(wa);
  await pool.end();
  console.log(`🏁 Test finalizado con éxito.\n`);
}

main().catch(async (e) => {
  console.error("Error en test:", e);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
