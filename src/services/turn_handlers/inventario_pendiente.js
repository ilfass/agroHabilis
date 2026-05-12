"use strict";

/**
 * Handler: `inventario_pendiente` — confirmaciones SI/NO sobre un
 * borrador de inventario.
 *
 * Origen: `src/services/agent/pipeline/consulta_whatsapp.js` líneas 86-111.
 * Hasta hoy vivía DENTRO del `pipeline_agente`, lo que dejaba al
 * usuario en una caja negra cuando había un borrador esperando confirmación.
 *
 * Al enchufarlo al TurnController como handler explícito:
 * - Aparece en `turnTrace` (auditabilidad estilo Cursor).
 * - Tiene prioridad ALTA en la cadena (orden 4 en REGISTRO_HANDLERS),
 *   por encima de cualquier comando directo (alertas, finanzas, etc.).
 * - Si no hay borrador o el flow no manejó, cede turno limpio.
 *
 * Importante: este handler **no crea** borradores. Eso lo sigue
 * haciendo `pipeline_agente` cuando llega un mensaje de "registrar
 * inventario". Acá solo cerramos el ciclo: el usuario ya dijo "Lote 9.
 * 20 vaquillonas y 4 novillos", el bot le contestó "¿Confirmás?", y
 * ahora interpretamos su SI/NO/EDITAR.
 *
 * Migrado en: P2#10 paso L bis (después de la activación inicial).
 */

const { normalizarWhatsapp } = require("../../models/usuario");
const { guardarConsulta } = require("../../models/consulta");
const { obtenerPendiente } = require("../inventario/core");
const { manejarInventarioWhatsapp } = require("../inventario/whatsapp_flow");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerInventarioPendiente(ctx) {
  const usuarioId = ctx?.planCtx?.usuario?.id;
  if (!usuarioId) return { manejado: false };

  const pend = await obtenerPendiente(usuarioId);
  if (!pend) return { manejado: false };

  const inv = await manejarInventarioWhatsapp({
    texto: String(ctx.consulta || ""),
    usuarioId,
    numeroWhatsapp: normalizarWhatsapp(ctx.jid),
  });
  if (!inv?.manejado || inv.respuesta == null) return { manejado: false };

  /**
   * Persistencia del turno en `historial_consultas`, exactamente como
   * lo hacía el pipeline viejo. Es importante que esto quede acá: el
   * resumen del productor y el cupo mensual de consultas lo leen
   * desde esa tabla.
   */
  try {
    await guardarConsulta({
      usuarioId,
      whatsapp: normalizarWhatsapp(ctx.jid),
      pregunta: String(ctx.consulta || ""),
      respuesta: inv.respuesta,
      tokensUsados: null,
    });
  } catch (e) {
    console.warn("[inventario_pendiente] guardarConsulta falló:", e?.message || e);
  }

  return {
    manejado: true,
    respuesta: inv.respuesta,
    route: "registrar_inventario_pendiente",
    extraLog: { cultivo: null, confianza: "alta", msClasificador: 0 },
  };
}

module.exports = { handlerInventarioPendiente };
