#!/usr/bin/env node
/**
 * Simulación automatizada del flujo de onboarding y diálogo conversacional de Fabián de Haro.
 * 
 * Uso:
 *   node scripts/tools/simular-onboarding-fabian.js
 */
require("dotenv").config();

const { query, pool } = require("../../src/config/database");
const { normalizarWhatsapp } = require("../../src/models/usuario");
const { gestionarOnboarding } = require("../../src/services/onboarding");
const { procesarConsulta } = require("../../src/services/agent/pipeline/consulta_whatsapp");
const { registrar } = require("../../src/services/interacciones_captura");

// Activamos captura de interacciones para el número de prueba
const TEST_WA = "5491199820777";
process.env.CAPTURA_HILO_WHATSAPP = TEST_WA;

const TURNOS = [
  "Hola",
  "Fabian Gomez",
  "Buenos Aires, Tandil",
  "soja, maiz y ganaderia",
  "vacuno novillos",
  "si",
  "te conteste que si",
  "te conteste la primera pregunta"
];

async function limpiarUsuarioPrueba(waNorm) {
  await query(`DELETE FROM whatsapp_interaccion_log WHERE whatsapp_norm = $1`, [waNorm]);
  await query(`DELETE FROM historial_consultas WHERE whatsapp = $1`, [waNorm]);
  await query(`DELETE FROM onboarding_estado WHERE whatsapp = $1`, [waNorm]);
  const u = await query(`SELECT id FROM usuarios WHERE whatsapp = $1`, [waNorm]);
  const id = u.rows[0]?.id;
  if (id) {
    await query(`DELETE FROM stock_ganadero WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM usuario_ganaderia_perfil WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM perfil_productivo WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM usuario_cultivos WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM usuario_zonas WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM usuarios WHERE id = $1`, [id]);
  }
}

async function ejecutarTurno(wa, texto) {
  // 1. Registramos el mensaje entrante
  const usuario = await query(`SELECT id FROM usuarios WHERE whatsapp = $1`, [wa]).then(r => r.rows[0]?.id || null);
  await registrar({
    whatsappNorm: wa,
    usuarioId: usuario,
    direccion: "in",
    cuerpo: texto,
    ruta: "test"
  });

  // 2. Comprobamos flujo de Onboarding
  const onboarding = await gestionarOnboarding(wa, texto);
  if (onboarding.enOnboarding) {
    const respuesta = onboarding.respuesta || "";
    await registrar({
      whatsappNorm: wa,
      usuarioId: usuario,
      direccion: "out",
      cuerpo: respuesta,
      ruta: "onboarding"
    });
    return { user: texto, bot: respuesta, route: "onboarding" };
  }

  // 3. Flujo clásico de consulta (IA Grounding o Tool-first)
  const respuesta = await procesarConsulta(wa, texto);
  const usuarioActualizado = await query(`SELECT id FROM usuarios WHERE whatsapp = $1`, [wa]).then(r => r.rows[0]?.id || null);
  await registrar({
    whatsappNorm: wa,
    usuarioId: usuarioActualizado,
    direccion: "out",
    cuerpo: respuesta,
    ruta: "pipeline"
  });
  return { user: texto, bot: respuesta, route: "pipeline" };
}

async function main() {
  const wa = normalizarWhatsapp(TEST_WA);
  console.log(`\n=============================================================`);
  console.log(`🤖 SIMULADOR AUTOMÁTICO DE CONVERSACIÓN (Número: ${wa})`);
  console.log(`=============================================================\n`);

  console.log(`🧹 Limpiando registros anteriores de prueba...`);
  await limpiarUsuarioPrueba(wa);
  console.log(`✅ Base de datos limpia de forma segura.\n`);

  for (let i = 0; i < TURNOS.length; i++) {
    const texto = TURNOS[i];
    console.log(`👤 [Usuario]: "${texto}"`);
    
    try {
      const turn = await ejecutarTurno(wa, texto);
      console.log(`🤖 [Bot - ${turn.route}]:`);
      console.log(`-------------------------------------------------------------`);
      console.log(turn.bot);
      console.log(`-------------------------------------------------------------\n`);
    } catch (e) {
      console.error(`❌ Error en turno:`, e);
    }
  }

  console.log(`🧹 Limpiando registros de prueba posteriores...`);
  await limpiarUsuarioPrueba(wa);
  console.log(`✅ Base de datos limpia de forma segura.\n`);
  
  await pool.end();
}

main().catch(async (e) => {
  console.error("Error fatal en simulación:", e);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
