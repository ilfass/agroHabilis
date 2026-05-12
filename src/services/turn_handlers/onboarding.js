"use strict";

/**
 * Handler: `onboarding` — flujo de alta del productor.
 *
 * Origen: `src/config/whatsapp.js` líneas 716-735.
 *
 * Es **stateful**: `gestionarOnboarding` mantiene el paso del alta en
 * `onboarding_estado` (DB). Si el usuario está en onboarding, captura
 * TODO mensaje hasta que termine, salvo que sea admin.
 *
 * Migrado en: P2#10 paso L.2.
 *
 * Convenciones:
 * - **Admins están exentos** (igual que el original).
 * - El mensaje del onboarding se envía vía `client.sendMessage` (no
 *   `msg.reply` con cita) y SIN humanizar — preserva 1:1 el comportamiento.
 *   Para eso usamos `ctx.send` que en `whatsapp.js` ya está atado a
 *   `client.sendMessage(jid, texto)`.
 * - Registramos la captura `out` con `ruta:"onboarding"` vía
 *   `ctx.emitCaptura(...)`.
 * - Devolvemos `respuesta: null` porque el flujo ya envió; el caller no
 *   debe duplicar el reply.
 */

const { gestionarOnboarding } = require("../onboarding");
const { formatearRespuestaAmigable } = require("../whatsapp_textos");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerOnboarding(ctx) {
  if (ctx?.esAdmin) return { manejado: false };

  const onboarding = await gestionarOnboarding(ctx.jid, ctx.consulta || "");
  if (!onboarding?.enOnboarding) return { manejado: false };

  if (onboarding.respuesta) {
    const out = formatearRespuestaAmigable(String(onboarding.respuesta));
    if (typeof ctx.send === "function") {
      await ctx.send(out);
    }
    if (typeof ctx.emitCaptura === "function") {
      try {
        ctx.emitCaptura(out, "onboarding");
      } catch (e) {
        console.warn("[onboarding] emitCaptura falló:", e?.message || e);
      }
    }
  }

  return {
    manejado: true,
    respuesta: null,
    route: "ONBOARDING_FLOW",
    extraLog: { tieneRespuesta: Boolean(onboarding.respuesta) },
  };
}

module.exports = { handlerOnboarding };
