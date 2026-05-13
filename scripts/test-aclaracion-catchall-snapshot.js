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

const path = require("path");
const dbPath = path.join(__dirname, "..", "src", "config", "database.js");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: async () => ({ rows: [] }), pool: { end: async () => {} } },
};

const {
  detectarPreguntaAmbiguaCatchAll,
} = require("../src/services/agent/pipeline/consulta_whatsapp");

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
