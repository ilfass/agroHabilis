"use strict";

/**
 * Handler: `pipeline_agente` — el "default" final de la cadena.
 *
 * Origen: `src/config/whatsapp.js` flujo final que invoca
 * `procesarConsulta` (o lo encola en `agent/queue/tarea_fila`).
 *
 * Es el ÚLTIMO handler de la cadena: si ningún comando explícito ni
 * flujo conversacional matcheó, dejamos que el pipeline tipo agente
 * (clasificador → refuerzos → gates → scout → OAV → router) decida.
 *
 * Convenciones:
 * - Lee `ctx.flags.asyncCola` (env `AGENT_CONSULTA_ASYNC`) para decidir
 *   si encolar (modo prod recomendado) o procesar sync (modo debug).
 * - En modo async: encola y responde con `respuesta: null` para que el
 *   caller no haga reply (la cola enviará después).
 * - En modo sync: corre `procesarConsulta` y devuelve el texto.
 * - Si todo falla, devuelve `manejado: false` para que el código viejo
 *   tome el control (durante la migración) o se muestre un error
 *   genérico (post paso M).
 *
 * Migrado en: P2#10 paso L bis.
 */

const { procesarConsulta } = require("../consultas");
const { encolarConsultaWhatsapp } = require("../agent/queue/tarea_fila");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerPipelineAgente(ctx) {
  const consulta = String(ctx?.consulta || "");
  if (!consulta) return { manejado: false };

  if (ctx?.flags?.asyncCola) {
    try {
      await encolarConsultaWhatsapp({
        whatsapp: ctx.jid,
        consulta,
      });
      return {
        manejado: true,
        respuesta: null,
        route: "PIPELINE_AGENTE_ENCOLADA",
      };
    } catch (e) {
      console.warn("[pipeline_agente] encolar falló, fallback sync:", e?.message || e);
    }
  }

  try {
    const respuesta = await procesarConsulta(ctx.jid, consulta, {});
    return {
      manejado: true,
      respuesta: typeof respuesta === "string" ? respuesta : String(respuesta || ""),
      route: "PIPELINE_AGENTE_SYNC",
    };
  } catch (e) {
    console.error("[pipeline_agente] procesarConsulta error:", e?.message || e);
    return { manejado: false };
  }
}

module.exports = { handlerPipelineAgente };
