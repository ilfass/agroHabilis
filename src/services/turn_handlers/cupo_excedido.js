"use strict";

/**
 * Handler: `cupo_excedido` — gate de cupo mensual del plan.
 *
 * Origen: `src/config/whatsapp.js` líneas 1921-1932.
 *
 * Solo aplica si hay usuario registrado. Si superó el cupo del plan,
 * corta acá con upsell. Si no, deja pasar al pipeline IA.
 *
 * Migrado en: P2#10 paso K.
 */

const { validarCupoConsultasMensual } = require("../planes");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCupoExcedido(ctx) {
  if (!ctx?.planCtx?.usuario?.id) return { manejado: false };

  const cupo = await validarCupoConsultasMensual({
    usuarioId: ctx.planCtx.usuario.id,
    planEfectivo: ctx.planCtx.planEfectivo,
  });
  if (cupo?.ok) return { manejado: false };

  return {
    manejado: true,
    respuesta: `Alcanzaste el límite de ${cupo?.limite ?? "N"} consultas este mes en Plan Gratis. Pasate a Plan Básico para consultas ilimitadas.`,
    route: "CUPO_EXCEDIDO",
    extraLog: { limite: cupo?.limite, restante: cupo?.restante },
  };
}

module.exports = { handlerCupoExcedido };
