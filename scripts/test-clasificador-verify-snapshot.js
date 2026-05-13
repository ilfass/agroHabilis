#!/usr/bin/env node
/**
 * Snapshots del **verificador LLM** de coherencia intención + historial.
 * No llama APIs: inyecta `llamarVerificador` que devuelve JSON fijo.
 *
 *   node scripts/test-clasificador-verify-snapshot.js
 */

"use strict";

const {
  verificarCoherenciaIntencionConHistorialLLM,
  normalizarClasificacion,
} = require("../src/services/clasificador");

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
];

const main = async () => {
  let ok = 0;
  let fail = 0;
  for (const c of CASOS) {
    const base = normalizarClasificacion(c.inicial);
    const out = await verificarCoherenciaIntencionConHistorialLLM(c.mensaje, base, c.historial, {
      llamarVerificador: c.mock,
    });
    const paso = out.intencion === c.esperado;
    if (paso) ok += 1;
    else fail += 1;
    console.log(`  ${paso ? "✓" : "✗"} ${c.titulo} → ${out.intencion} (esperado ${c.esperado})`);
  }
  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  process.exit(fail ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
