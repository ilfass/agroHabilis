"use strict";

/**
 * Helpers de formateo de texto saliente de WhatsApp.
 *
 * Extraído de `src/config/whatsapp.js` (~línea 139) en el paso L del
 * TurnController (P2#10) para que los handlers stateful (onboarding,
 * resumen_interactivo) puedan formatear el texto antes de mandarlo por
 * `client.sendMessage` SIN tener que requerir `whatsapp.js` y caer en
 * dependencia circular.
 *
 * Mantiene exactamente la misma lógica: marcado en negrita+emoji para
 * etiquetas habituales y compresión de saltos múltiples, después del
 * enriquecedor general (`enriquecerTextoWhatsApp`).
 */

const { enriquecerTextoWhatsApp } = require("../utils/whatsapp_enriquecer");

const formatearRespuestaAmigable = (texto = "") => {
  let t = String(texto || "").trim();
  if (!t) return t;
  t = t
    .replace(/^Rango:/gim, "📊 *Rango:*")
    .replace(/^Promedio:/gim, "📈 *Promedio:*")
    .replace(/^Tendencia:/gim, "📉 *Tendencia:*")
    .replace(/^Recomendación:/gim, "✅ *Recomendación:*")
    .replace(/^Fecha:/gim, "🗓️ *Fecha:*")
    .replace(/^Tipo de dato:/gim, "🏷️ *Tipo de dato:*")
    .replace(/\n{3,}/g, "\n\n");
  return enriquecerTextoWhatsApp(t.trim());
};

module.exports = { formatearRespuestaAmigable };
