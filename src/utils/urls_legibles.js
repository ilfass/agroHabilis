"use strict";

/**
 * URLs de grounding (Gemini/Vertex) suelen ser redirects largos e inusables en WhatsApp.
 * Mostramos dominio + path corto, o una etiqueta fija para redirects de Google.
 */
function etiquetaUrlParaWhatsApp(url, index) {
  const raw = String(url || "").trim();
  if (!raw.startsWith("http")) return `ref.${index}`;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, "");
    if (
      /vertexaisearch\.cloud\.google\.com$/i.test(host) ||
      /grounding-api-redirect/i.test(raw) ||
      /\/grounding-api-redirect\//i.test(u.pathname)
    ) {
      return `Google (${index})`;
    }
    let path = u.pathname;
    if (path.length > 1) path = path.replace(/\/$/, "");
    if (path.length > 52) path = `${path.slice(0, 50)}…`;
    return path && path !== "/" ? `${host}${path}` : host;
  } catch {
    return `ref.${index}`;
  }
}

/** Una línea para anexar al final del bloque de complemento web (sin URLs kilométricas). */
function formatearFuentesGroundingWhatsApp(urls) {
  if (!Array.isArray(urls) || !urls.length) return "";
  const partes = urls.slice(0, 5).map((u, i) => etiquetaUrlParaWhatsApp(u, i + 1));
  return `\n🔗 *Fuentes (resumen):* ${partes.join(" · ")}`;
}

module.exports = {
  etiquetaUrlParaWhatsApp,
  formatearFuentesGroundingWhatsApp,
};
