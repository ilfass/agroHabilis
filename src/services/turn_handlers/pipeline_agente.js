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
      /**
       * Contrato real de la cola: `{ jid, consulta, opciones }`
       * (ver `agent/queue/tarea_fila.js` y `drenar_consulta_whatsapp.js`).
       * Antes pasábamos `whatsapp` por error → el drenador descartaba la
       * tarea como `payload_invalido` y el productor NUNCA recibía
       * respuesta cuando `AGENT_CONSULTA_ASYNC=1`.
       */
      await encolarConsultaWhatsapp({
        jid: ctx.jid,
        consulta,
        opciones: {},
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
      /**
       * `yaHumanizada=true` evita que `whatsapp.js` haga un SEGUNDO pase
       * por `humanizarSalidaConIA` sobre una respuesta que ya fue
       * generada por el LLM dentro del pipeline. Antes hacíamos 2 LLM
       * calls por mensaje (latencia x2 + a veces la reescritura rompía
       * formato).
       */
      yaHumanizada: true,
      route: "PIPELINE_AGENTE_SYNC",
    };
  } catch (e) {
    console.error("[pipeline_agente] procesarConsulta error:", e?.message || e);
    return { manejado: false };
  }
}

module.exports = { handlerPipelineAgente };
