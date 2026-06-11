#!/usr/bin/env node
/**
 * Snapshots del **verificador LLM** de coherencia intención + historial.
 * No llama APIs: inyecta `llamarVerificador` que devuelve JSON fijo.
 *
 *   node scripts/test-clasificador-verify-snapshot.js
 */

"use strict";

process.env.AGENT_CURSOR_MODE = "0";
process.env.AGENT_IA_TOTAL = "0";
process.env.AGENT_UNIFIED_TURN_LOOP = "0";
process.env.AGENT_CLASIFICADOR_EN_BUCLE = "0";
process.env.INVENTARIO_SOLO_LLM = "0";
process.env.DIALOGO_HILO_SIN_ATAJO_HEURISTICO = "0";

const {
  verificarCoherenciaIntencionConHistorialLLM,
  normalizarClasificacion,
} = require("../../src/services/clasificador");

const HIST_PRECIO_SOJA = [
  {
    pregunta: "el precio de la soja hoy",
    respuesta:
      "Hola Fabián, la soja en Rosario (CAC) promedia los $455.794/tn con datos al 11/05/2026 (fuente: cac_bcr).",
  },
];

const HIST_INV_OK = [
  {
    pregunta: "si",
    respuesta:
      "✅ Listo, guardado en inventario.\n🐄 20 vaquillonas\n📍 Lote: 9\n📅 12/05/2026",
  },
];

const mockRetorna = (obj) => async () => JSON.stringify(obj);

const CASOS = [
  {
    titulo: "verify: novillo tras precio soja → precio",
    mensaje: "Y el novillo?",
    historial: HIST_PRECIO_SOJA,
    inicial: { intencion: "consulta_registros" },
    mock: mockRetorna({
      coherente: false,
      intencion: "precio",
      motivo: "Seguimiento de cotización de mercado.",
    }),
    esperado: "precio",
  },
  {
    titulo: "verify: y el resto tras inventario → registrar",
    mensaje: "Y el resto?",
    historial: HIST_INV_OK,
    inicial: { intencion: "agro_general" },
    mock: mockRetorna({
      coherente: false,
      intencion: "registrar",
      motivo: "Seguimiento de carga de inventario.",
    }),
    esperado: "registrar",
  },
  {
    titulo: "verify: coherente true no cambia",
    mensaje: "Y el novillo?",
    historial: HIST_PRECIO_SOJA,
    inicial: { intencion: "precio" },
    mock: mockRetorna({ coherente: true }),
    esperado: "precio",
  },
  {
    titulo: "verify: sin historial qué día → agro_general + meta fecha",
    mensaje: "¿Qué día es hoy?",
    historial: [],
    inicial: { intencion: "analisis_mercado" },
    mock: mockRetorna({
      coherente: false,
      intencion: "agro_general",
      meta_consulta: "fecha",
      motivo: "Solo calendario civil.",
    }),
    esperado: "agro_general",
    esperadoMeta: "fecha",
  },
];

const main = async () => {
  let ok = 0;
  let fail = 0;
  for (const c of CASOS) {
    const base = normalizarClasificacion(c.inicial);
    const out = await verificarCoherenciaIntencionConHistorialLLM(c.mensaje, base, c.historial, {
      llamarVerificador: c.mock,
    });
    const pasoInt = out.intencion === c.esperado;
    const pasoMeta = c.esperadoMeta == null ? true : out.meta_consulta === c.esperadoMeta;
    const paso = pasoInt && pasoMeta;
    if (paso) ok += 1;
    else fail += 1;
    const metaInfo = c.esperadoMeta != null ? ` meta=${out.meta_consulta ?? "null"} (esperado ${c.esperadoMeta})` : "";
    console.log(`  ${paso ? "✓" : "✗"} ${c.titulo} → ${out.intencion}${metaInfo}`);
  }
  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  process.exit(fail ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
