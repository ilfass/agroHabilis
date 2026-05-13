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
 * Si el texto del usuario es claramente de OTRO dominio (precio/clima/etc.),
 * preferimos ceder el turno al pipeline general en vez de bombardear con
 * recordatorios del borrador pendiente. Si NO matchea otro dominio, el
 * mensaje probablemente es atributo del registro en curso ("dos están
 * enfermas", "una preñada", "el toro grande") o aclaración ambigua, y
 * devolvemos recordatorio en vez de dejar que el LLM responda "personas
 * enfermas" (sesión 2026-05-13).
 */
const esConsultaOtroDominioExplicita = (texto = "") => {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!t) return false;
  if (
    /\b(precio|cotizacion|valor|pizarra|mercado|d[oó]lar|dolar|euro|insumo|fertilizante|herbicida|semilla|flete)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(clima|llueve|llover|llovi[oó]|temperatura|pron[oó]stico|helada|granizo|viento)\b/.test(t)) {
    return true;
  }
  if (/\b(mi\s+resumen|mis\s+alertas|mi\s+margen|mis\s+ventas|mis\s+gastos|ver\s+comandos|planes)\b/.test(t)) {
    return true;
  }
  /** Meta sobre la app (no inventario). */
  if (/\b(sos\s+(un\s+)?(agente|bot)|qu[eé]\s+(es|hace|sos))\b/.test(t)) return true;
  return false;
};

/** Mensajes claramente "cancelo/dejame primero hacer otra cosa". */
const esPedidoCancelarPendiente = (texto = "") => {
  const t = String(texto || "").toLowerCase().trim();
  return /\b(cancelar|cancela|cancelemos|olvidalo|olvidate|dejalo|dejemos|no\s+lo\s+guardes|no\s+importa)\b/.test(t);
};

const construirRecordatorioPendiente = (pend) => {
  const pp = (() => {
    try {
      return typeof pend?.payload === "string" ? JSON.parse(pend.payload) : pend?.payload || {};
    } catch (_e) {
      return {};
    }
  })();
  const desc = (() => {
    if (pp?.cabezas) return `${pp.cabezas} cab${pp?.categoria ? ` de ${pp.categoria}` : ""}`;
    if (pp?.hectareas) return `${pp.hectareas} ha${pp?.cultivo ? ` de ${pp.cultivo}` : ""}`;
    if (pp?.cantidad && pp?.unidad) return `${pp.cantidad} ${pp.unidad}${pp?.item ? ` de ${pp.item}` : ""}`;
    return "registro";
  })();
  const lote = pend?.lote_nombre ? `📍 Lote: *${pend.lote_nombre}*` : "establecimiento";
  return [
    "Antes de seguir, tengo este borrador esperando confirmación:",
    `${lote} | 🐾 ${desc}`,
    "",
    "Decime *SI* para guardarlo o *NO* para descartarlo.",
    "Si querés agregar info (ej. «dos están enfermas» como nota), primero confirmá y después la anotamos en el lote.",
  ].join("\n");
};

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerInventarioPendiente(ctx) {
  const usuarioId = ctx?.planCtx?.usuario?.id;
  if (!usuarioId) return { manejado: false };

  const pend = await obtenerPendiente(usuarioId);
  if (!pend) return { manejado: false };

  const consultaRaw = String(ctx.consulta || "");

  /** Cancelación explícita: dejamos que el flow legacy procese SI/NO/cancelar. */
  if (!esPedidoCancelarPendiente(consultaRaw) && esConsultaOtroDominioExplicita(consultaRaw)) {
    /**
     * Otro dominio (precio/clima/etc.): cedemos el turno al pipeline
     * general. El recordatorio podría ser molesto si el productor
     * cambió de tema; mejor dejarlo resolver y que el borrador siga
     * vivo (expira por TTL).
     */
    return { manejado: false };
  }

  const inv = await manejarInventarioWhatsapp({
    texto: consultaRaw,
    usuarioId,
    numeroWhatsapp: normalizarWhatsapp(ctx.jid),
  });

  let respuesta = null;
  let routeFinal = "registrar_inventario_pendiente";
  if (inv?.manejado && inv.respuesta != null) {
    respuesta = inv.respuesta;
  } else {
    /**
     * Hay borrador pendiente pero el mensaje no es SI/NO ni encaja en
     * ningún branch del flow. En vez de dejar que el pipeline general
     * lo interprete (caso 2026-05-13: "Dos estaban enfermas" terminó
     * en "personas enfermas"), devolvemos recordatorio explícito del
     * borrador y le ofrecemos al productor un camino claro.
     */
    respuesta = construirRecordatorioPendiente(pend);
    routeFinal = "inventario_pendiente_recordatorio";
  }

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
      pregunta: consultaRaw,
      respuesta,
      tokensUsados: null,
    });
  } catch (e) {
    console.warn("[inventario_pendiente] guardarConsulta falló:", e?.message || e);
  }

  return {
    manejado: true,
    respuesta,
    route: routeFinal,
    extraLog: { cultivo: null, confianza: "alta", msClasificador: 0 },
  };
}

module.exports = { handlerInventarioPendiente };
