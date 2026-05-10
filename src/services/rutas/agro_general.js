"use strict";

const fs = require("fs");
const path = require("path");
const H = require("../consultas/legacy_helpers");

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
  const pregunta = ctx
    ? `${mensaje}\n\n--- Material interno de referencia (fragmentos) ---\n${ctx}`
    : mensaje;

  const out = await H.renderTemplate("consulta", usuario, pregunta);
  return H.enriquecerConGroundingAgroSiHaceFalta({
    pregunta: mensaje,
    textoBase: H.sanitizarPlaceholders(String(out?.mensaje || "").trim()),
  });
};

module.exports = { rutaAgroGeneral, cargarFragmentosContexto };
