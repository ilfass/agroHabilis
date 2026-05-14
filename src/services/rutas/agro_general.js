"use strict";

const fs = require("fs");
const path = require("path");
const H = require("../consultas/legacy_helpers");
const { esPreguntaMetaConversacional } = require("../clasificador");
const { esQuejaCorreccionRespuestaBot } = require("../intent_classifier");

const CONTEXTO_DIR = path.join(__dirname, "../../../docs/contexto-ia");

const stop = new Set([
  "cuando",
  "como",
  "cual",
  "para",
  "sobre",
  "tengo",
  "hacer",
  "está",
  "esta",
  "del",
  "las",
  "los",
  "una",
  "unos",
]);

function tokens(msg) {
  return String(msg || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9áéíóúñ]+/i)
    .filter((w) => w.length > 3 && !stop.has(w));
}

function cargarFragmentosContexto(mensaje, maxArchivos = 3, maxChars = 3500) {
  if (!fs.existsSync(CONTEXTO_DIR)) return "";
  const files = fs
    .readdirSync(CONTEXTO_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md");
  const tk = tokens(mensaje);
  const scored = files
    .map((f) => {
      const base = f.replace(/^\d+-/, "").replace(/\.md$/, "").replace(/-/g, " ");
      const score = tk.reduce((acc, w) => (base.includes(w) ? acc + 2 : acc), 0);
      return { f, score };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = (scored[0]?.score > 0 ? scored : scored.map((x) => ({ ...x, score: 1 }))).slice(0, maxArchivos);

  const parts = [];
  let total = 0;
  for (const { f } of chosen) {
    const full = path.join(CONTEXTO_DIR, f);
    try {
      const raw = fs.readFileSync(full, "utf8");
      const slice = raw.slice(0, Math.floor(maxChars / maxArchivos));
      parts.push(`--- ${f} ---\n${slice}`);
      total += slice.length;
      if (total >= maxChars) break;
    } catch (_e) {
      /* */
    }
  }
  return parts.join("\n\n");
}

const lineasAyudaRecurso = (recurso = "") => {
  const r = String(recurso || "").trim().toLowerCase();
  if (r === "venta") {
    return [
      "Para *registrar una venta*, escribime con montos claros:",
      '- «Vendí 120 tn de maíz a 185.000 por tn» — o también en quintales («qq»).',
      "Cuando cargues varias operaciones seguidas, sumo contra tu mes.",
    ].join("\n");
  }
  if (r === "gasto") {
    return [
      "Para *registrar un gasto*:",
      '- «Gasté 890.000 en fertilizante urea», «Compré 12 bolsas de semilla…».',
      'Indicá monto + concepto para que pueda clasificarlo.',
    ].join("\n");
  }
  if (r === "comandos") {
    return [
      "*Comandos destacados*: *MI RESUMEN*, *MIS ALERTAS*, *MI MARGEN*, *PLANES*, *VER COMANDOS*.",
      "También podés hablarme en natural: cotizaciones, clima, «avisame cuando la soja pase X».",
    ].join("\n");
  }
  return [
    "Para usar el bot: podés cargar gastos y ventas en texto, pedir precios o clima, o usar comandos en mayúsculas.",
    "Escribí *VER COMANDOS* para ver la lista completa.",
  ].join("\n");
};

const rutaAgroGeneral = async ({ clasificacion, mensaje, usuario }) => {
  const rawMsg = String(mensaje || "").trim();

  if (clasificacion?._correccionConversacional || esQuejaCorreccionRespuestaBot(rawMsg)) {
    try {
      const { texto } = await H.generarConPromptLibre({
        system: [
          "Sos AgroHabilis (WhatsApp, productor argentino).",
          "El usuario indica que tu respuesta anterior no era lo que pedía o que repetís el mismo ofrecimiento (precio/clima/análisis).",
          "Reglas estrictas:",
          "- Máximo 3 líneas, tono breve y natural rioplatense.",
          "- Disculpá sin dramatizar.",
          "- NO ofrezcas menús tipo «precio, clima o análisis» ni listas de temas.",
          "- Si pedía la hora o el día, respondé solo eso usando zona America/Argentina/Buenos_Aires (no inventes otros datos).",
          "- Si no alcanza para inferir, una sola pregunta abierta: qué dato quería.",
          "- Sin bloque de mercado, sin «Base AgroHabilis», sin cifras de cotización salvo que el usuario las haya pedido en este mensaje.",
        ].join(" "),
        user: `Mensaje del usuario: ${rawMsg.slice(0, 450)}`,
      });
      const out = String(texto || "").trim();
      if (out) return out;
    } catch (_e) {
      /* fallback abajo */
    }
    const h = new Date().toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
    });
    const d = new Date().toLocaleString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Argentina/Buenos_Aires",
    });
    const tn = rawMsg
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (/\bhora\b/.test(tn)) {
      return `Perdón la confusión.\n⏰ Son las *${h}* (hora Argentina).`;
    }
    if (/\b(d[ií]a|fecha)\b/.test(tn)) {
      return `Perdón la confusión.\n📅 Hoy es *${d}* (Argentina).`;
    }
    return (
      "Perdón, me despisté con lo anterior.\n" +
      "Decime en *una línea* qué necesitás (fecha de hoy, hora, o un precio concreto) y te respondo directo, sin el menú de siempre."
    );
  }

  const meta = clasificacion?.meta_consulta;
  if (meta === "fecha") {
    const s = new Date().toLocaleString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Argentina/Buenos_Aires",
    });
    return `📅 Hoy es *${s}* (Argentina).`;
  }
  if (meta === "hora") {
    const h = new Date().toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
    });
    return `⏰ Son las *${h}* (hora Argentina).`;
  }

  if (clasificacion?.ayuda_recurso) {
    return lineasAyudaRecurso(clasificacion.ayuda_recurso);
  }

  const ctx = cargarFragmentosContexto(mensaje);
  const scout = String(clasificacion?.agentScoutContext || "").trim();
  const bloqueScout = scout
    ? `\n\n--- Hallazgos previos (scout / herramientas) ---\n${scout}\n`
    : "";
  const pregunta = ctx
    ? `${mensaje}${bloqueScout}\n\n--- Material interno de referencia (fragmentos) ---\n${ctx}`
    : scout
      ? `${mensaje}${bloqueScout}`
      : mensaje;

  const out = await H.renderTemplate("consulta", usuario, pregunta);
  const textoBase = H.sanitizarPlaceholders(String(out?.mensaje || "").trim());
  const int = String(clasificacion?.intencion || "").trim();
  const omitirWeb =
    ["saludo", "small_talk", "no_agro"].includes(int.toLowerCase()) ||
    Boolean(clasificacion?._guardrailMetaConversacional) ||
    esPreguntaMetaConversacional(mensaje);
  return H.enriquecerConGroundingAgroSiHaceFalta({
    pregunta: mensaje,
    textoBase,
    intencion: int || "agro_general",
    omitirComplementoWeb: omitirWeb,
  });
};

module.exports = { rutaAgroGeneral, cargarFragmentosContexto };
