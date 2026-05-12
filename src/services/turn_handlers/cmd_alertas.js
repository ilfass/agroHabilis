"use strict";

/**
 * Handler: `cmd_alertas` — comandos relacionados con alertas de precio.
 *
 * Origen unificado de cuatro ramas:
 * - `whatsapp.js` ~1402 — `__ALERTA__` (intent IA, no comienza con
 *   ALERTA/AVISAME, ya cubierto por la rama natural).
 * - `whatsapp.js` ~1721 — `MIS ALERTAS` (listar).
 * - `whatsapp.js` ~1734 — `CANCELAR ALERTA <id>` (cancelar).
 * - `whatsapp.js` ~1746 — `ALERTA ...` / `AVISAME ...` (configurar).
 *
 * Migrado en: P2#10 paso D.
 *
 * Pre-condición común: el plan del usuario debe permitir alertas. Si no,
 * mensaje uniforme orientando a `QUIERO PLAN BASICO`.
 */

const {
  configurarAlerta,
  listarAlertas,
  cancelarAlerta,
} = require("../alertas");
const { puedeUsarAlertas } = require("../planes");

const MSG_NO_PLAN =
  "Las alertas de precio están disponibles en Plan Básico o Pro. Escribí 'QUIERO PLAN BASICO' para activarlas.";

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdAlertas(ctx) {
  const alias = String(ctx?.comandoAlias || "").toUpperCase();
  const natural = String(ctx?.comandoNatural || "").toUpperCase();
  const planEf = ctx?.planCtx?.planEfectivo;

  if (alias === "MIS ALERTAS" || natural === "MIS ALERTAS") {
    if (!puedeUsarAlertas(planEf)) {
      return { manejado: true, respuesta: MSG_NO_PLAN, route: "CMD_MIS_ALERTAS" };
    }
    const r = await listarAlertas(ctx.jid);
    return { manejado: true, respuesta: r, route: "CMD_MIS_ALERTAS" };
  }

  if (alias.startsWith("CANCELAR ALERTA")) {
    if (!puedeUsarAlertas(planEf)) {
      return {
        manejado: true,
        respuesta: "Tu plan actual no incluye alertas de precio.",
        route: "CMD_CANCELAR_ALERTA",
      };
    }
    const id = String(ctx.consulta || "").match(/(\d+)/)?.[1];
    const r = await cancelarAlerta(ctx.jid, id);
    return { manejado: true, respuesta: r, route: "CMD_CANCELAR_ALERTA", extraLog: { id } };
  }

  if (alias.startsWith("ALERTA") || alias.startsWith("AVISAME")) {
    if (!puedeUsarAlertas(planEf)) {
      return {
        manejado: true,
        respuesta:
          "Las alertas de precio están disponibles en Plan Básico o Pro. Escribí 'QUIERO PLAN BASICO' y te ayudamos a activarlo.",
        route: "CMD_ALERTA",
      };
    }
    const r = await configurarAlerta(ctx.jid, ctx.consulta);
    return { manejado: true, respuesta: r, route: "CMD_ALERTA" };
  }

  /** `__ALERTA__` natural (IA detectó intent alerta sin alias explícito). */
  if (natural === "__ALERTA__" && !alias.startsWith("ALERTA") && !alias.startsWith("AVISAME")) {
    if (!puedeUsarAlertas(planEf)) {
      return { manejado: true, respuesta: MSG_NO_PLAN, route: "CMDN_ALERTA_NATURAL" };
    }
    const r = await configurarAlerta(ctx.jid, ctx.consulta);
    return { manejado: true, respuesta: r, route: "CMDN_ALERTA_NATURAL" };
  }

  return { manejado: false };
}

module.exports = { handlerCmdAlertas };
