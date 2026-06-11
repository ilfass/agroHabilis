#!/usr/bin/env node
/**
 * Snapshot tests del detector de preguntas catch-all que disparan
 * repregunta inmediata desde el pipeline (sin importar la confianza
 * del clasificador). Casos sacados de la sesión 2026-05-12:
 *
 *   - "mercado" → data-dump (12 bullets) en vez de "¿de qué?"
 *   - "Y con respecto al registro?" → respuesta inventando inventario
 *   - "podes guardar todos juntos?" → respuesta sobre lotes 87/71 random
 *
 * Uso:
 *   node scripts/test-aclaracion-catchall-snapshot.js
 */

"use strict";

require("dotenv").config({ override: false });

process.env.AGENT_CURSOR_MODE = "0";
process.env.AGENT_IA_TOTAL = "0";
process.env.AGENT_UNIFIED_TURN_LOOP = "0";
process.env.AGENT_CLASIFICADOR_EN_BUCLE = "0";
process.env.INVENTARIO_SOLO_LLM = "0";
process.env.DIALOGO_HILO_SIN_ATAJO_HEURISTICO = "0";

const path = require("path");
const dbPath = path.join(__dirname, "..", "..", "src", "config", "database.js");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: async () => ({ rows: [] }), pool: { end: async () => {} } },
};

const {
  detectarPreguntaAmbiguaCatchAll,
} = require("../../src/services/agent/pipeline/consulta_whatsapp");
const { parecePreguntaCapacidadOMetaFeedback, esPreguntaMetaConversacional } = require("../../src/services/clasificador");

const CASOS_REPREGUNTA = [
  { msg: "mercado", expectIncluye: ["¿De qué", "soja"] },
  { msg: "Mercado", expectIncluye: ["¿De qué"] },
  { msg: "precios?", expectIncluye: ["¿De qué"] },
  { msg: "precios", expectIncluye: ["¿De qué"] },
  { msg: "cotización", expectIncluye: ["¿De qué"] },
  { msg: "Y el mercado", expectIncluye: ["¿De qué"] },
  { msg: "Hoy el mercado", expectIncluye: ["¿De qué"] },
  { msg: "Y con respecto al registro?", expectIncluye: ["Registrar", "consultar"] },
  { msg: "Y respecto al inventario?", expectIncluye: ["Registrar", "consultar"] },
  { msg: "Y respecto a las ventas", expectIncluye: ["Registrar", "consultar"] },
  { msg: "podes guardar todos juntos?", expectIncluye: ["varios"] },
  { msg: "Podés cargar varios a la vez?", expectIncluye: ["varios"] },
  { msg: "se pueden guardar varios?", expectIncluye: ["varios"] },
  { msg: "Y los precios?", expectIncluye: ["concreto"] },
  { msg: "Y la soja?", expectIncluye: ["concreto"] },
];

const CASOS_PASA = [
  /** No catch-all: tiene cultivo o pedido claro. */
  { msg: "precio soja" },
  { msg: "cuanto está la soja hoy" },
  { msg: "va a llover esta semana?" },
  { msg: "hola" },
  { msg: "20 vacas en lote 3" },
  { msg: "MI RESUMEN" },
  /** Seguimiento conocido: el clasificador ya forzó intent. */
  {
    msg: "mercado",
    clasificacion: { _refuerzoSeguimientoHistorial: true },
  },
  {
    msg: "mercado",
    clasificacion: { cultivo: "soja" },
  },
];

const fmt = (s, w) => String(s).padEnd(w, " ");

const main = () => {
  let ok = 0;
  let fail = 0;
  const errs = [];

  console.log("== Casos que SÍ requieren repregunta catch-all ==");
  for (const c of CASOS_REPREGUNTA) {
    const r = detectarPreguntaAmbiguaCatchAll(c.msg, null);
    const passes =
      typeof r === "string" &&
      r.length > 0 &&
      (c.expectIncluye || []).every((sub) => r.toLowerCase().includes(sub.toLowerCase()));
    if (passes) ok += 1;
    else {
      fail += 1;
      errs.push({ msg: c.msg, real: r, esperado: c.expectIncluye });
    }
    console.log(
      `  ${passes ? "✓" : "✗"} ${fmt(JSON.stringify(c.msg), 42)} → ${
        r ? r.slice(0, 60).replace(/\n/g, " ⏎ ") : "(null)"
      }`
    );
  }

  console.log("\n== Casos que NO deben dispararla ==");
  for (const c of CASOS_PASA) {
    const r = detectarPreguntaAmbiguaCatchAll(c.msg, c.clasificacion || null);
    const passes = r === null;
    if (passes) ok += 1;
    else {
      fail += 1;
      errs.push({ msg: c.msg, real: r, esperado: null });
    }
    console.log(
      `  ${passes ? "✓" : "✗"} ${fmt(JSON.stringify(c.msg), 42)} → ${r ? r.slice(0, 40) : "(null)"}`
    );
  }

  console.log("\n== Guardrail léxico amplio (capacidad / feedback) ==");
  const CAP_FEED_TRUE = [
    "Pero te estoy preguntando otra cosa",
    "no me entendiste",
    "no era eso",
    "ese no es el indice",
    "tiene que ser otro",
    "puedo registrar novillos en mi lote?",
  ];
  for (const msg of CAP_FEED_TRUE) {
    const p = parecePreguntaCapacidadOMetaFeedback(msg);
    const passes = p === true;
    if (passes) ok += 1;
    else {
      fail += 1;
      errs.push({ msg, real: p, esperado: true });
    }
    console.log(`  ${passes ? "✓" : "✗"} pareceCapMeta ${fmt(JSON.stringify(msg), 42)} → ${p}`);
  }
  const CAP_FEED_FALSE = ["precio soja", "MI RESUMEN", "cuántas vacas tengo en lote 3", "mercado"];
  for (const msg of CAP_FEED_FALSE) {
    const p = parecePreguntaCapacidadOMetaFeedback(msg);
    const passes = p === false;
    if (passes) ok += 1;
    else {
      fail += 1;
      errs.push({ msg, real: p, esperado: false });
    }
    console.log(`  ${passes ? "✓" : "✗"} no-capMeta ${fmt(JSON.stringify(msg), 42)} → ${p}`);
  }

  /** Correcciones + capacidad activan esPreguntaMetaConversacional (OR con lista corta). */
  console.log("\n== esPreguntaMetaConversacional incluye guardrail amplio ==");
  for (const msg of CAP_FEED_TRUE) {
    const m = esPreguntaMetaConversacional(msg);
    const passes = m === true;
    if (passes) ok += 1;
    else {
      fail += 1;
      errs.push({ msg, real: m, esperado: true });
    }
    console.log(`  ${passes ? "✓" : "✗"} esMeta ${fmt(JSON.stringify(msg), 42)} → ${m}`);
  }

  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail > 0) {
    console.log("\nDetalle de fallos:");
    for (const e of errs) {
      console.log(`- ${JSON.stringify(e.msg)}: real=${JSON.stringify(e.real)} esperado=${JSON.stringify(e.esperado)}`);
    }
    process.exit(1);
  }
};

main();
