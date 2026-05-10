#!/usr/bin/env node
require("dotenv").config();

const { detectarIntencionIA, inferirComandoNatural } = require("../../../src/services/whatsapp_intents");
const { procesarConsulta } = require("../../../src/services/consultas");

const TEST_WHATSAPP = process.env.TEST_WHATSAPP || "5490000000000";

const casos = [
  "Escuchaste sobre alguna noticia de fertilizante?",
  "cuanto esta la soja",
  "conviene vender o espero",
  "hola buen dia",
  "y el dolar como esta hoy",
  "mi campo en azul tuvo helada esta semana?",
  "gasté 2 millones en glifosato",
  "mandame el resumen de hoy",
  "qué alertas tengo activas?",
  "quiero saber cuánto gané este mes",
];

const estimarFuente = (intencion) => {
  if (intencion?.tipo === "comando") return "comando";
  return "BD + snapshot (+fuente externa si falta frescura)";
};

const resolverIntencionEfectiva = async (mensaje) => {
  const heur = inferirComandoNatural(mensaje);
  const ia = await detectarIntencionIA(mensaje);
  return { heuristica: heur, ia };
};

async function run() {
  const out = [];
  for (let i = 0; i < casos.length; i += 1) {
    const mensaje = casos[i];
    const t0 = Date.now();
    const intencion = await resolverIntencionEfectiva(mensaje);
    const respuesta = await procesarConsulta(TEST_WHATSAPP, mensaje);
    const ms = Date.now() - t0;
    out.push({
      caso: i + 1,
      mensaje,
      intencion,
      busqueda: estimarFuente(intencion?.ia),
      respuesta: String(respuesta || "").slice(0, 1200),
      ms,
    });
  }

  console.log("=== RESULTADOS TEST RESPUESTAS ===");
  for (const r of out) {
    console.log(`\nCaso ${r.caso}: ${r.mensaje}`);
    console.log(`- Intención detectada: ${JSON.stringify(r.intencion)}`);
    console.log(`- Qué datos buscó: ${r.busqueda}`);
    console.log(`- Respuesta generada: ${r.respuesta}`);
    console.log(`- Tiempo: ${r.ms} ms`);
  }
}

run().catch((e) => {
  console.error("Error ejecutando test-respuestas:", e.message);
  process.exit(1);
});

