"use strict";

/**
 * Handler: `bot_pausado` — gate "estado del bot en este chat".
 *
 * Origen: `src/config/whatsapp.js` líneas 1900-1919.
 *
 * Si el bot está pausado para este JID, ignora la consulta. Excepción:
 * si el mensaje es un comando válido de control (ACTIVAR BOT /
 * ESTADO BOT...), lo procesa para que el usuario pueda re-activarlo.
 *
 * Importante: usa `replySinIA` (no bypass por IA libre) para no consumir
 * cupo ni disparar pipeline cuando está pausado.
 *
 * Migrado en: P2#10 paso K.
 */

const { manejarComandoBot, obtenerEstadoBot } = require("../consultas");
const { parseComandoBot } = require("../consultas/bot_control");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerBotPausado(ctx) {
  const consulta = ctx?.consulta || "";
  const botActivo = await obtenerEstadoBot(ctx.jid);
  if (botActivo) return { manejado: false };

  /** Comando de control dentro de pausa (ej: ACTIVAR BOT). */
  const cmdCtrl = parseComandoBot(consulta);
  if (cmdCtrl) {
    const rBot = await manejarComandoBot(ctx.jid, consulta);
    if (rBot) {
      /** Usamos `replySinIA` para evitar enriquecimiento por IA libre. */
      if (typeof ctx.replySinIA === "function") {
        await ctx.replySinIA(rBot);
        return { manejado: true, respuesta: null, route: "CMD_BOT_CTRL_EN_PAUSA" };
      }
      return { manejado: true, respuesta: rBot, route: "CMD_BOT_CTRL_EN_PAUSA" };
    }
    return { manejado: true, respuesta: null, route: "CMD_BOT_CTRL_EN_PAUSA_SILENCIOSO" };
  }

  /** Consulta ignorada — bot pausado. Avisamos sin IA. */
  console.log(`[WhatsApp] Consulta ignorada por bot pausado en chat ${ctx.jid}`);
  if (typeof ctx.replySinIA === "function") {
    try {
      await ctx.replySinIA(
        "En este chat el bot está *pausado*. Para que vuelva a responder escribí: *ACTIVAR BOT*"
      );
    } catch (e) {
      console.warn("[WhatsApp] No se pudo avisar bot pausado:", e?.message || e);
    }
    return { manejado: true, respuesta: null, route: "BOT_PAUSADO" };
  }
  return {
    manejado: true,
    respuesta:
      "En este chat el bot está *pausado*. Para que vuelva a responder escribí: *ACTIVAR BOT*",
    route: "BOT_PAUSADO",
  };
}

module.exports = { handlerBotPausado };
