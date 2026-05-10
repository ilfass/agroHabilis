#!/usr/bin/env node
/**
 * Ejecuta N consultas vía procesarConsulta (misma ruta que WhatsApp) y muestra
 * preview de respuesta + último historial_consultas (ia_provider_trace).
 *
 * Uso:
 *   node scripts/tools/prueba-consultas-traza.js
 *   TEST_WHATSAPP=5491123456789 node scripts/tools/prueba-consultas-traza.js
 */
require("dotenv").config();

const { procesarConsulta } = require("../../src/services/consultas");
const { query } = require("../../src/config/database");
const { normalizarWhatsapp } = require("../../src/models/usuario");

const PREGUNTAS_DEFAULT = [
  "Precio de la soja",
  "¿Cuánto está el maíz hoy?",
  "Precios de granos",
  "Tipo de cambio oficial y blue",
  "Clima para mañana en mi zona",
];

function sinDatosNegativos(texto) {
  const t = String(texto || "");
  return (
    /\bsin datos en base\b/i.test(t) ||
    /\bsin dato puntual hoy\b/i.test(t) ||
    /\bsin dato en base\b/i.test(t)
  );
}

async function main() {
  const wa = normalizarWhatsapp(process.env.TEST_WHATSAPP || "5490000000000");
  const preguntas = process.env.PREGUNTAS_EXTRA
    ? String(process.env.PREGUNTAS_EXTRA)
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean)
    : PREGUNTAS_DEFAULT;

  const casos = [];
  for (const pregunta of preguntas) {
    const t0 = Date.now();
    let respuesta = "";
    let err = null;
    try {
      respuesta = await procesarConsulta(wa, pregunta);
    } catch (e) {
      err = String(e?.message || e);
    }
    const ms = Date.now() - t0;

    const last = await query(
      `
        SELECT id, ia_provider_trace, tokens_usados, ia_sin_contexto, ia_provider, creado_en
        FROM historial_consultas
        WHERE whatsapp = $1
        ORDER BY id DESC
        LIMIT 1
      `,
      [wa]
    );
    const row = last.rows[0];

    casos.push({
      pregunta,
      ms,
      error: err,
      sin_datos_negativos: err ? null : sinDatosNegativos(respuesta),
      respuesta_preview: err ? null : String(respuesta || "").slice(0, 700),
      historial_id: row?.id,
      ia_provider: row?.ia_provider,
      ia_sin_contexto: row?.ia_sin_contexto,
      tokens_usados: row?.tokens_usados,
      ia_provider_trace: row?.ia_provider_trace,
      historial_creado_en: row?.creado_en,
    });
  }

  const resumen = {
    whatsapp: wa,
    generatedAt: new Date().toISOString(),
    preguntas_total: preguntas.length,
    casos_con_sin_datos: casos.filter((c) => c.sin_datos_negativos === true).length,
    casos_sin_sin_datos: casos.filter((c) => c.sin_datos_negativos === false).length,
    casos,
  };

  console.log(JSON.stringify(resumen, null, 2));
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
