"use strict";

/**
 * Handler: `cupo_excedido` — gate de cupo semanal del plan (audios, fotos e interacciones).
 */

const { validarLimitesSemanales } = require("../planes");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCupoExcedido(ctx) {
  if (!ctx?.planCtx?.usuario?.id) return { manejado: false };

  // Detectar si la consulta entrante contenía audio o foto
  const esAudio = Boolean(ctx.consulta && ctx.consulta.includes("[Audio transcrito:"));
  const esFoto = Boolean(ctx.consulta && ctx.consulta.includes("[Análisis de archivo:"));

  const cupo = await validarLimitesSemanales({
    usuarioId: ctx.planCtx.usuario.id,
    planEfectivo: ctx.planCtx.planEfectivo,
    esAudio,
    esFoto,
  });

  if (cupo?.ok) return { manejado: false };

  return {
    manejado: true,
    respuesta: cupo.mensaje || "Alcanzaste tu límite semanal de uso. Pasate a un plan superior para continuar.",
    route: "CUPO_EXCEDIDO",
    extraLog: { razon: cupo?.razon, usadas: cupo?.usadas, limite: cupo?.limite },
  };
}

module.exports = { handlerCupoExcedido };
