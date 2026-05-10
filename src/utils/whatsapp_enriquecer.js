/**
 * Normaliza texto hacia convenciones de WhatsApp (*negrita*, _cursiva_, separadores).
 * Se aplica a casi todas las salidas en `formatearRespuestaAmigable`.
 */
function enriquecerTextoWhatsApp(texto = "") {
  let t = String(texto || "").replace(/\r\n/g, "\n");
  if (!t.trim()) return t.trim();

  // Markdown típico → WhatsApp
  t = t.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  t = t.replace(/__([^_]+)__/g, "_$1_");
  t = t.replace(/^#{1,4}\s+(.+)$/gm, "*$1*");

  // Separadores solo guiones/medias → barra doble
  t = t.replace(/^[─\-]{5,}\s*$/gm, "━━━━━━━━━━━━━━━━━━━━");
  t = t.replace(/^[=_]{5,}\s*$/gm, "━━━━━━━━━━━━━━━━━━━━");

  // Bloques de aviso / web más legibles
  t = t.replace(/^Referencias web\s*\(/gim, "🌐 *Referencias web* (");
  t = t.replace(/^Aviso:\s*/gim, "⚠️ _Aviso:_ ");
  t = t.replace(/^Enlaces:\s*/gim, "🔗 *Enlaces:*\n");

  // Compactar saltos excesivos
  t = t.replace(/\n{4,}/g, "\n\n\n").trim();
  return t;
}

module.exports = { enriquecerTextoWhatsApp };
