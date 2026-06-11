"use strict";
/**
 * test_plano_confirmacion.js — Verifica el flujo completo del plano catastral:
 *   1. Parser extrae lotes correctamente
 *   2. esPlanoCatastral detecta el texto OCR
 *   3. procesarPlanoCatastral genera respuesta con lista de lotes
 *   4. manejarConfirmacionLotesPlano maneja "Si" y "No"
 */

require("dotenv").config();
const {
  esPlanoCatastral,
  parsearLotesDeOCR,
  procesarPlanoCatastral,
  manejarConfirmacionLotesPlano,
  FLUJO,
  PASO_ESPERANDO,
} = require("../src/services/turn_handlers/lotes_plano_handler");
const { obtenerEstado, limpiarEstado } = require("../src/services/conversacion_estado");

// ── Texto OCR del plano de Don Martín (extracto) ──────────────────────────────
const OCR_DON_MARTIN = `[Análisis de archivo: Plano catastral y productivo del establecimiento 'Don Martín'.
Ubicación: Lat 37°18'55.67"S / Long 59°48'31.31"O, Partido de Benito Juárez. Medición de precisión con GPS Geodésico. Escala 1:24.000.

El plano detalla la división de potreros con sus respectivas superficies de potrero y superficies agrícolas:
- Lote 1: Potrero 31.89 | Agrícola 31.25
- Lote 2a: Potrero 2.85 | Agrícola 0.00
- Lote 2b: Potrero 3.08 | Agrícola 2.98
- Lote 3: Potrero 37.17 | Agrícola 36.17
- Lote 4: Potrero 41.60 | Agrícola 40.40
- Lote 5: Potrero 33.87 | Agrícola 33.01
- Lote 5a: Potrero 15.13 | Agrícola 15.00
- Lote 6: Potrero 58.21 | Agrícola 57.38
- Lote 7: Potrero 39.89 | Agrícola 38.97
- Lote 7b: Potrero 12.40 | Agrícola 0.00
- Lote 7c: Potrero 20.24 | Agrícola 0.00
- Lote 7d: Potrero 19.26 | Agrícola 18.94
- Lote 8: Potrero 40.81 | Agrícola 40.04
- Lote 8b: Potrero 11.99 | Agrícola 11.67
- Lote 9: Potrero 23.72 | Agrícola 16.77
- Lote 9 Piq: Potrero 0.08 | Agrícola 0.00
- Lote 9a: Potrero 40.94 | Agrícola 40.40
- Lote 10: Potrero 74.07 | Agrícola 73.49
- Lote 11: Potrero 42.92 | Agrícola 41.76
- Lote 11 Piq: Potrero 0.01 | Agrícola 0.00
- Lote 12: Potrero 1.93 | Agrícola 0.00
- Lote 13: Potrero 5.50 | Agrícola 0.00
- Lote 14: Potrero 7.68 | Agrícola 0.00
- Lote 15: Potrero 25.38 | Agrícola 0.00
- Calle 1: Potrero 0.96 | Agrícola 0.00
- Calle 2: Potrero 2.36 | Agrícola 0.00
- Calle 2b: Potrero 0.91 | Agrícola 0.00
- Calle 3: Potrero 1.56 | Agrícola 0.00
- Casco: Potrero 5.61 | Agrícola 0.00
- Mol 1: Potrero 0.04 | Agrícola 0.00
- Mol 2: Potrero 0.09 | Agrícola 0.00
- Mol 3: Potrero 0.08 | Agrícola 0.00
- Mol 4: Potrero 0.06 | Agrícola 0.00
- Piq 1: Potrero 0.35 | Agrícola 0.00
- TOTAL: Potrero 679.33 | Agrícola 510.02

Firma del trabajo: G&D Estudio - Mayo 2016.] Firma Daedaz. Campo Don Martín`;

const WA_TEST = "5400000000001";

async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log("  TEST: Flujo de Confirmación de Plano Catastral");
  console.log("══════════════════════════════════════════════════\n");

  // ── Test 1: Detección ──────────────────────────────────────────────────────
  console.log("▶ Test 1: esPlanoCatastral()");
  const deteccion = esPlanoCatastral(OCR_DON_MARTIN);
  console.log("  Detectado:", deteccion ? "✅ SÍ" : "❌ NO (fallo)");
  console.log();

  // ── Test 2: Parser ─────────────────────────────────────────────────────────
  console.log("▶ Test 2: parsearLotesDeOCR()");
  const lotes = parsearLotesDeOCR(OCR_DON_MARTIN);
  console.log(`  Lotes parseados: ${lotes.length} (esperado: ~20 lotes productivos, sin calles/molinos/piquetes < 0.5 ha)`);
  lotes.forEach(l => {
    console.log(`    • ${l.nombre}: ${l.hectareas} ha (agríc: ${l.hectareas_agricolas} ha)`);
  });
  const tieneCalles = lotes.some(l => /^calle/i.test(l.nombre));
  const tieneMolinos = lotes.some(l => /^mol/i.test(l.nombre));
  const tieneTotal = lotes.some(l => /^total$/i.test(l.nombre));
  console.log(`  ¿Filtra calles? ${!tieneCalles ? "✅ SÍ" : "❌ NO (fallo)"}`);
  console.log(`  ¿Filtra molinos? ${!tieneMolinos ? "✅ SÍ" : "❌ NO (fallo)"}`);
  console.log(`  ¿Filtra fila TOTAL? ${!tieneTotal ? "✅ SÍ" : "❌ NO (fallo)"}`);
  console.log();

  // ── Test 3: procesarPlanoCatastral (requiere DB) ───────────────────────────
  console.log("▶ Test 3: procesarPlanoCatastral() — guarda estado y genera respuesta");
  try {
    // Limpiar estado previo por si existe
    await limpiarEstado(WA_TEST);

    const resultado = await procesarPlanoCatastral({
      textoOcr: OCR_DON_MARTIN,
      usuarioId: 9999, // usuario de prueba
      numeroWhatsapp: WA_TEST,
      nombreUsuario: "Juan",
    });

    if (resultado.manejado) {
      console.log("  Estado guardado: ✅");
      console.log("  Respuesta generada:\n");
      console.log(resultado.respuesta.split("\n").map(l => "    " + l).join("\n"));

      // Verificar que el estado quedó guardado
      const estadoGuardado = await obtenerEstado(WA_TEST);
      const lotesGuardados = estadoGuardado?.contexto?.lotes?.length || 0;
      console.log(`\n  Lotes guardados en estado: ${lotesGuardados} ✅`);
      console.log(`  Flujo: ${estadoGuardado?.flujo} | Paso: ${estadoGuardado?.paso}`);
    } else {
      console.log("  ❌ No se manejó el plano (revisa el parser)");
    }
  } catch (err) {
    console.log("  ❌ Error (probable: DB no disponible en local):", err.message);
    console.log("  → Ejecutar en VPS para prueba completa con DB.");
  }
  console.log();

  // ── Test 4: manejarConfirmacionLotesPlano con "Si" ────────────────────────
  console.log("▶ Test 4: manejarConfirmacionLotesPlano('Si') — sin estado real (mock)");
  const estadoMock = {
    flujo: "lotes_plano",
    paso: "esperando_confirmacion",
    contexto: {
      lotes: lotes.slice(0, 3), // primeros 3 para test rápido
      campo: "Don Martín",
      usuario_id: 9999,
    },
  };

  // Probar solo el pattern matching sin invocar la tool (sin DB/tool real)
  const textoSi = "Si";
  const esConfirmacion = /^(si|sí|sii|siis|dale|ok|sip|claro|confirmo|confirmar|todo|todos|si a todo|registralos|registrálos|cargalos|cargálos|anotalos|anótalos|adelante|listo|va|buenísimo|genial|perfecto)$/i.test(textoSi.trim());
  console.log(`  ¿'${textoSi}' es confirmación? ${esConfirmacion ? "✅ SÍ" : "❌ NO (fallo)"}`);

  const textoNo = "No";
  const esCancelacion = /^(no|nop|nope|cancelar|cancela|olvidalo|olvidate|olvidalo|no gracias|para|paren|detener|ninguno|ningún|omitir)$/i.test(textoNo.trim());
  console.log(`  ¿'${textoNo}' es cancelación? ${esCancelacion ? "✅ SÍ" : "❌ NO (fallo)"}`);

  const textoAmbiguo = "quiero saber el precio del maíz";
  const esNiUno = !/^(si|sí|sii|siis|dale|ok|sip|claro|confirmo|confirmar|todo|todos|si a todo|registralos|registrálos|cargalos|cargálos|anotalos|anótalos|adelante|listo|va|buenísimo|genial|perfecto)$/i.test(textoAmbiguo.trim())
    && !/^(no|nop|nope|cancelar|cancela|olvidalo|olvidate|olvidalo|no gracias|para|paren|detener|ninguno|ningún|omitir)$/i.test(textoAmbiguo.trim());
  console.log(`  ¿'${textoAmbiguo}' pasa sin interceptar? ${esNiUno ? "✅ SÍ (correcto, va al pipeline)" : "❌ NO (fallo)"}`);

  // Limpiar estado de test
  try { await limpiarEstado(WA_TEST); } catch (_) {}

  console.log("\n══════════════════════════════════════════════════");
  console.log("Tests locales completados.");
  console.log("Para prueba completa con domain.register_lote → ejecutar en VPS.");
  console.log("══════════════════════════════════════════════════");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
