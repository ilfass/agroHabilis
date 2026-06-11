"use strict";

/**
 * Handler: `cmd_cambio_plan` — cambio de plan del productor.
 *
 * Origen: 4 puntos en `src/config/whatsapp.js` que hacían exactamente lo
 * mismo con distintos contextos:
 *
 * 1. ~línea 977: "natural temprano" (heurística de `inferirComandoNatural`,
 *    antes de `detectarIntencionIA`, para evitar que Gemini lo desvíe).
 * 2. ~línea 1006: "ruta dura" por alias (`comandoAlias === "QUIERO PLAN X"`).
 * 3. ~línea 1137: "natural post-IA" (`comandoNatural === "QUIERO PLAN X"`).
 * 4. ~línea 1401: alias tardío (duplicado del punto 2).
 *
 * Migrado en: P2#10 paso G. La lógica de orquestación
 * (`resolverCambioPlanConPago` + `mensajeErrorCambioPlan`) se extrajo
 * previamente a `services/cambio_plan.js`, así no se acopla a símbolos
 * internos de whatsapp.js y otros caminos (API REST de pagos) pueden
 * compartirlo.
 *
 * Estrategia de match:
 * - Si `comandoAlias` es uno de "QUIERO PLAN GRATIS/BASICO/PRO" → match.
 * - Si `comandoNatural` (provisto por el caller, opcional) es uno → match.
 * - Si `inferirComandoNatural(ctx.consulta)` devuelve uno → match.
 *
 * Esto cubre los 4 puntos viejos con una sola implementación, sin
 * depender de en qué orden corra detectarIntencionIA.
 */

const { inferirComandoNatural } = require("../whatsapp_intents");
const {
  resolverCambioPlanConPago,
  mensajeErrorCambioPlan,
} = require("../cambio_plan");

const MSG_SIN_REGISTRO =
  "Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.";

const PLANES_VALIDOS = new Set([
  "QUIERO PLAN GRATIS",
  "QUIERO PLAN BASICO",
  "QUIERO PLAN PRO",
  "QUIERO PLAN PRO MAX",
  "QUIERO PLAN PROMAX",
]);

const detectarPedidoPlan = (ctx) => {
  const alias = String(ctx?.comandoAlias || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (PLANES_VALIDOS.has(alias)) return alias;
  const natural = String(ctx?.comandoNatural || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (PLANES_VALIDOS.has(natural)) return natural;
  const heur = String(inferirComandoNatural(ctx?.consulta || "") || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (PLANES_VALIDOS.has(heur)) return heur;
  return null;
};

const planObjetivoDesdeAlias = (alias) => {
  if (alias.endsWith("PRO MAX") || alias.endsWith("PROMAX")) return "pro_max";
  if (alias.endsWith("PRO")) return "pro";
  if (alias.endsWith("BASICO")) return "basico";
  return "gratis";
};

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdCambioPlan(ctx) {
  const pedido = detectarPedidoPlan(ctx);
  if (!pedido) return { manejado: false };

  if (!ctx?.planCtx?.usuario?.id) {
    return {
      manejado: true,
      respuesta: MSG_SIN_REGISTRO,
      route: "CMD_CAMBIO_PLAN_SIN_USUARIO",
      extraLog: { pedido },
    };
  }

  const planObjetivo = planObjetivoDesdeAlias(pedido);
  try {
    const texto = await resolverCambioPlanConPago({
      whatsapp: ctx.jid,
      planObjetivo,
    });
    return {
      manejado: true,
      respuesta: texto,
      route: "CMD_CAMBIO_PLAN",
      extraLog: { pedido, planObjetivo },
    };
  } catch (error) {
    console.error("[CMD_CAMBIO_PLAN] error:", error?.message || error);
    return {
      manejado: true,
      respuesta: mensajeErrorCambioPlan(error),
      route: "CMD_CAMBIO_PLAN_ERROR",
      extraLog: { pedido, planObjetivo, error: String(error?.message || error) },
    };
  }
}

module.exports = { handlerCmdCambioPlan, detectarPedidoPlan };
