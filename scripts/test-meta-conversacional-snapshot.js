#!/usr/bin/env node
/**
 * Snapshot tests del guardrail meta-conversacional del clasificador.
 *
 * Contexto: en la sesión 2026-05-12 el productor envió mensajes como
 * "Sos un agente o un Chatbot?", "Tengo recomendaciones para hacerte",
 * "Quiero saber si eso se puede hacer en esta app", "De qué trata
 * agroHabilis?" — y el bot le respondía con "No logré reconocer el
 * comando..." (modo robot/comando rígido).
 *
 * Estos casos prueban que `esPreguntaMetaConversacional` detecta esos
 * mensajes para desviarlos del fallback de `rutaComando` al pipeline
 * conversacional general (rutaAgroGeneral).
 *
 * Uso:
 *   node scripts/test-meta-conversacional-snapshot.js
 */

"use strict";

require("dotenv").config({ override: false });

const { esPreguntaMetaConversacional } = require("../src/services/clasificador");

const CASOS_META_TRUE = [
  "Sos un agente o un Chatbot?",
  "sos un bot?",
  "sos un asistente o un humano?",
  "Ya sos un agente?",
  "De qué trata agroHabilis?",
  "de qué se trata?",
  "qué hace este bot",
  "qué podés hacer?",
  "para qué sirve esto?",
  "cómo funcionás?",
  "Tengo recomendaciones para hacerte",
  "Tengo recomendaciones para hacerles. Algunas cosas que deberían mejorar",
  "Tengo sugerencias para mejorar",
  "Te quería preguntar algo",
  "te decía que tengo recomendaciones",
  "Quiero saber si eso se puede hacer en esta app",
  "Quiero saber cómo funciona",
  "Eso se puede hacer en esta app?",
  "Pero todavía no te las dí",
  "podes guardar todos juntos?",
  "podés procesar varios a la vez?",
  "Por qué me contestas como un robot?",
  "es un bot esto?",
  "Y con respecto al registro?",
  "Y respecto al inventario?",
];

const CASOS_META_FALSE = [
  /** Comandos reales: NO deben ser tratados como meta-charla. */
  "MI RESUMEN",
  "MIS ALERTAS",
  "VER COMANDOS",
  "QUIERO PLAN PRO",
  "COMPLETAR PERFIL",
  "avisame cuando la soja supere 440000",
  /** Mensajes operativos con números: NO son meta. */
  "20 vacas en lote 3",
  "Lote 9 20 vaquillonas y un ternero",
  "gasté 500000 en glifosato",
  "vendí 100 tn de soja a 270000",
  /** Preguntas operativas legítimas (precio/clima/etc.): NO son meta. */
  "cuánto está la soja hoy?",
  "va a llover esta semana?",
  "precio del dólar",
  "conviene vender o esperar?",
  /** Saludos / small_talk normales (otros handlers): NO son meta. */
  "hola",
  "gracias",
  "dale",
];

const fmt = (s, w) => String(s).padEnd(w, " ");

const main = async () => {
  let pasados = 0;
  let fallados = 0;
  const errores = [];

  console.log("== Casos que SÍ son meta-conversacionales ==");
  for (const msg of CASOS_META_TRUE) {
    const real = esPreguntaMetaConversacional(msg);
    const ok = real === true;
    if (ok) pasados += 1;
    else {
      fallados += 1;
      errores.push({ mensaje: msg, esperado: true, real });
    }
    console.log(`  ${ok ? "✓" : "✗"} ${fmt(msg.slice(0, 50), 52)} real=${real}`);
  }

  console.log("\n== Casos que NO son meta-conversacionales ==");
  for (const msg of CASOS_META_FALSE) {
    const real = esPreguntaMetaConversacional(msg);
    const ok = real === false;
    if (ok) pasados += 1;
    else {
      fallados += 1;
      errores.push({ mensaje: msg, esperado: false, real });
    }
    console.log(`  ${ok ? "✓" : "✗"} ${fmt(msg.slice(0, 50), 52)} real=${real}`);
  }

  console.log(`\nResumen: ${pasados} OK, ${fallados} fallidos.`);
  if (fallados > 0) {
    console.log("\nDetalle de fallos:");
    for (const e of errores) {
      console.log(`- "${e.mensaje}" esperado=${e.esperado} real=${e.real}`);
    }
    process.exit(1);
  }
};

main().catch((e) => {
  console.error("[snapshot] error inesperado:", e?.message || e);
  process.exit(2);
});
