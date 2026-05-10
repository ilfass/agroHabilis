#!/usr/bin/env node
require("dotenv").config();

const { procesarConsulta } = require("../src/services/consultas");
const { normalizarWhatsapp } = require("../src/models/usuario");

const TEST_WHATSAPP = normalizarWhatsapp(process.env.TEST_WHATSAPP || "5490000000000");
const PREGUNTAS = process.env.PREGUNTAS_PRECIOS
  ? String(process.env.PREGUNTAS_PRECIOS)
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean)
  : [
      "Cuando está la cebada hoy?",
      "Cuánto está la soja hoy?",
      "Precio del sorgo",
      "Precio del maíz Rosario",
    ];

const esConsultaPrecio = (pregunta = "") =>
  /\b(precio|cotizacion|cuanto|cuando\s+esta|esta\s+la|vale|cuesta|disponible|pizarra|rosario|matba|rofex)\b/i.test(
    String(pregunta || "")
  );

const cumpleMinimos = (texto = "") => {
  const t = String(texto || "");
  const tienePrecio = /((ars|usd|u\$s)\s*\d|\$\s*\d|\d\s*(ars|usd|u\$s))/i.test(t);
  const tieneFecha = /\b\d{4}-\d{2}-\d{2}\b/.test(t) || /\b\d{2}[/-]\d{2}(?:[/-]\d{2,4})?\b/.test(t);
  const tieneFuenteOMercado = /\b(fuente|mercado|matba|rofex|rosario|cac|bcr|magyp|afa|siogranos)\b/i.test(t);
  return tienePrecio && tieneFecha && tieneFuenteOMercado;
};

async function run() {
  const resultados = [];
  let failures = 0;

  for (const pregunta of PREGUNTAS) {
    const t0 = Date.now();
    let respuesta = "";
    let error = null;
    try {
      respuesta = await procesarConsulta(TEST_WHATSAPP, pregunta);
    } catch (e) {
      error = String(e?.message || e);
    }
    const ms = Date.now() - t0;
    const ok = !error && (!esConsultaPrecio(pregunta) || cumpleMinimos(respuesta));
    if (!ok) failures += 1;
    resultados.push({
      pregunta,
      ms,
      ok,
      error,
      preview: String(respuesta || "").slice(0, 500),
    });
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), total: resultados.length, failures, resultados }, null, 2));
  if (failures > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Error en test-precios-minimos:", e.message);
  process.exit(1);
});

