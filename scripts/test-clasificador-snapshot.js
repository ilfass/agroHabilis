#!/usr/bin/env node
/**
 * Snapshot tests del clasificador **heurístico** (sin IA).
 *
 * - No usa IA ni base de datos: corre en < 1s.
 * - La continuidad de hilo (precio tras cotización, inventario tras carga)
 *   se cubre en `scripts/test-clasificador-verify-snapshot.js` con mocks
 *   del segundo pase LLM (`verificarCoherenciaIntencionConHistorialLLM`).
 *
 * Uso:
 *   node scripts/test-clasificador-snapshot.js
 */

"use strict";

require("dotenv").config({ override: false });

const { clasificarHeuristica, normalizarClasificacion } = require("../src/services/clasificador");

const {
  parseIntentInventario,
  detectarCargaMultiLote,
} = require("../src/services/inventario/nl_heuristica");

const evaluarClasificador = (mensaje) => normalizarClasificacion(clasificarHeuristica(mensaje));

const CASOS_INTENT = [
  /* Saludos / small_talk */
  { titulo: "saludo: hola", mensaje: "Hola", intencion: "saludo" },
  { titulo: "saludo: gracias", mensaje: "gracias", intencion: "saludo" },
  { titulo: "small_talk: tengo sueño", mensaje: "Tengo sueño", intencion: "small_talk" },
  { titulo: "small_talk: ok", mensaje: "ok", intencion: "small_talk" },
  { titulo: "small_talk: jajaja", mensaje: "jajaja", intencion: "small_talk" },
  { titulo: "small_talk: dale", mensaje: "dale", intencion: "small_talk" },

  /* Inventario / registrar */
  { titulo: "registrar: 20 vacas lote 3", mensaje: "20 vacas en lote 3", intencion: "registrar" },
  { titulo: "registrar: Lote 5 30 vacas", mensaje: "Lote 5 30 vacas", intencion: "registrar" },
  { titulo: "registrar: cargar 50 ha soja", mensaje: "cargá 50 ha de soja en campo Sur", intencion: "registrar" },
  { titulo: "registrar: gasto con monto", mensaje: "gasté 500000 en glifosato", intencion: "registrar" },
  { titulo: "registrar: llovió mm", mensaje: "llovió 35 mm en el norte", intencion: "registrar" },
  { titulo: "registrar: un ternero", mensaje: "Lote 9 20 vaquillonas y un ternero", intencion: "registrar" },

  /* Precio */
  { titulo: "precio soja", mensaje: "cuánto está la soja hoy", intencion: "precio" },
  { titulo: "precio dólar", mensaje: "precio del dólar", intencion: "precio" },

  /* Clima */
  { titulo: "clima futuro", mensaje: "va a llover esta semana en Tandil", intencion: "clima" },

  /* Comandos */
  { titulo: "comando MI RESUMEN", mensaje: "MI RESUMEN", intencion: "comando" },
  { titulo: "comando PLANES", mensaje: "PLANES", intencion: "comando" },
  { titulo: "comando alerta", mensaje: "avisame cuando la soja supere 440000", intencion: "comando" },

  /* Consulta de registros / inventario (heurística: parseIntentInventario manda animales a registrar) */
  { titulo: "consulta gasto", mensaje: "cuánto gasté este mes", intencion: "consulta_registros" },
  { titulo: "consulta inventario animales", mensaje: "cuántos animales tengo en total", intencion: "registrar" },

  /* Análisis */
  { titulo: "analisis mercado: conviene vender", mensaje: "conviene vender o espero", intencion: "analisis_mercado" },
  { titulo: "analisis interno: mis costos", mensaje: "con mis costos me da?", intencion: "analisis_interno" },
];

const CASOS_MULTILOTE = [
  {
    titulo: "multi_lote: planilla con huecos",
    mensaje: [
      "Lote 1. Sin hacienda",
      "Lote 2b. 60 vaquillonas",
      "Lote 3. Sin hacienda",
      "Lote 4. 100 vaquillonas",
      "Lote 6. 106 vacas",
    ].join("\n"),
    bloquesConCarga: 3,
    bloquesSinCarga: 2,
  },
  {
    titulo: "multi_lote: dos lotes mínimo",
    mensaje: "Lote 9 20 vaquillonas y un ternero\nLote 14 4 novillos un toro",
    bloquesConCarga: 2,
    bloquesSinCarga: 0,
  },
  {
    titulo: "no multi_lote: un solo lote",
    mensaje: "Lote 5 30 vacas",
    bloquesConCarga: 0,
    bloquesSinCarga: 0,
    noEsMulti: true,
  },
];

const fmt = (s, w) => String(s).padEnd(w, " ");

const main = async () => {
  let pasados = 0;
  let fallados = 0;
  const errores = [];

  console.log("== Intenciones (solo clasificarHeuristica) ==");
  for (const c of CASOS_INTENT) {
    const out = evaluarClasificador(c.mensaje);
    const ok = out.intencion === c.intencion;
    if (ok) pasados += 1;
    else {
      fallados += 1;
      errores.push({ titulo: c.titulo, mensaje: c.mensaje, esperado: c.intencion, real: out.intencion });
    }
    console.log(`  ${ok ? "✓" : "✗"} ${fmt(c.titulo, 38)} esperado=${fmt(c.intencion, 18)} real=${out.intencion}`);
  }

  console.log("\n== Multi-lote (parser) ==");
  for (const c of CASOS_MULTILOTE) {
    const intent = parseIntentInventario(c.mensaje);
    if (c.noEsMulti) {
      const ok = intent?.clase !== "multi_lote";
      if (ok) pasados += 1;
      else {
        fallados += 1;
        errores.push({ titulo: c.titulo, mensaje: c.mensaje, esperado: "no multi_lote", real: intent?.clase });
      }
      console.log(`  ${ok ? "✓" : "✗"} ${fmt(c.titulo, 38)} clase=${intent?.clase || "null"}`);
      continue;
    }
    const detalle = detectarCargaMultiLote(c.mensaje);
    const cc = detalle?.bloques?.length ?? 0;
    const sc = detalle?.bloques_sin_carga?.length ?? 0;
    const ok = intent?.clase === "multi_lote" && cc === c.bloquesConCarga && sc === c.bloquesSinCarga;
    if (ok) pasados += 1;
    else {
      fallados += 1;
      errores.push({
        titulo: c.titulo,
        mensaje: c.mensaje,
        esperado: `multi_lote ${c.bloquesConCarga} con / ${c.bloquesSinCarga} sin`,
        real: `${intent?.clase} ${cc} con / ${sc} sin`,
      });
    }
    console.log(
      `  ${ok ? "✓" : "✗"} ${fmt(c.titulo, 38)} bloques_con=${cc}(${c.bloquesConCarga}) sin=${sc}(${c.bloquesSinCarga})`
    );
  }

  console.log(`\nResumen: ${pasados} OK, ${fallados} fallidos.`);
  if (fallados > 0) {
    console.log("\nDetalle de fallos:");
    for (const e of errores) {
      console.log(`- ${e.titulo}`);
      console.log(`  mensaje  : ${e.mensaje}`);
      console.log(`  esperado : ${e.esperado}`);
      console.log(`  real     : ${e.real}`);
    }
    process.exit(1);
  }
};

main().catch((e) => {
  console.error("[snapshot] error inesperado:", e?.message || e);
  process.exit(2);
});
