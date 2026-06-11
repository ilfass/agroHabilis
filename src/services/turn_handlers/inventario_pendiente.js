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
const { generarClasificacionIntencion } = require("../gemini");

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
  /** Creación de lotes explícita (e.g., "crear lote", "dar de alta el campo", "registrar tres campos", "dame de alta un campo"). */
  const tieneVerboCreacion = /\b(crear|crea|cree|dar\s+de\s+alta|dame\s+de\s+alta|registra|registrar|nuevo|sumar|suma|agregar|agrega|alta)\b/.test(t);
  const tieneSustantivoCampo = /\b(lote|lotes|campo|campos|potrero|potreros|firma|firmas|establecimiento|establecimientos)\b/.test(t);
  if (tieneVerboCreacion && tieneSustantivoCampo) return true;
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

const obtenerDescripcionBorrador = (pend) => {
  const pp = (() => {
    try {
      return typeof pend?.payload === "string" ? JSON.parse(pend.payload) : pend?.payload || {};
    } catch (_e) {
      return {};
    }
  })();
  const desc = (() => {
    if (pp?.cabezas) return `${pp.cabezas} cabezas${pp?.categoria ? ` de ${pp.categoria}` : ""}`;
    if (pp?.hectareas) return `${pp.hectareas} ha${pp?.cultivo ? ` de ${pp.cultivo}` : ""}`;
    if (pp?.cantidad && pp?.unidad) return `${pp.cantidad} ${pp.unidad}${pp?.item ? ` de ${pp.item}` : ""}`;
    return "registro de inventario";
  })();
  const lote = pend?.lote_nombre ? `lote ${pend.lote_nombre}` : "establecimiento";
  return `${desc} en ${lote}`;
};

/**
 * Clasifica la intención del usuario con respecto al borrador de inventario pendiente.
 * @param {string} textoUsuario 
 * @param {string} descBorrador 
 * @returns {Promise<string>} 'confirmar' | 'cancelar' | 'completar_datos' | 'comentario_adicional' | 'cambiar_tema' | null
 */
async function clasificarIntencionBorradorPendiente(textoUsuario, descBorrador) {
  try {
    const system = [
      "Clasificá la intención del usuario de un bot de WhatsApp agropecuario con respecto a un borrador de inventario que está esperando confirmación.",
      "Responder SOLO con un objeto JSON válido con la clave 'intencion' (sin markdown, sin bloques ```json).",
      "",
      "Las opciones válidas de 'intencion' son:",
      "- \"confirmar\": El usuario explícitamente acepta, confirma o valida el borrador para guardarlo (ej: \"si\", \"dale\", \"guardalo\", \"de una\", \"confirmar\", \"correcto\", \"metele\", \"está bien\").",
      "- \"cancelar\": El usuario explícitamente cancela, aborta, descarta o pide borrar el borrador (ej: \"no\", \"cancelar\", \"borralo\", \"no lo guardes\", \"olvidalo\", \"dejalo\", \"cancelemos\").",
      "- \"completar_datos\": El usuario proporciona información faltante que el bot le estaba pidiendo para poder registrar el borrador (ej: si le pide las hectáreas y el usuario responde \"80 ha\" o \"son 150 hectáreas\", o si le pide la categoría y responde \"novillos\").",
      "- \"comentario_adicional\": El usuario añade una nota, observación o aclaración sobre el borrador (ej: \"dos están enfermas\", \"hay una preñada\", \"pesan 320kg promedio\", \"lote seco\").",
      "- \"cambiar_tema\": El usuario claramente cambió de tema, pide realizar otra consulta o acción ajena al borrador pendiente (ej: \"cuánto está la soja\", \"crear el campo Daedaz\", \"clima en Tandil\", \"ver comandos\", \"hola\", \"buenas\").",
      "",
      "Ejemplo de formato de respuesta:",
      '{"intencion": "confirmar"}'
    ].join("\n");

    const user = [
      `Borrador pendiente: "${descBorrador}"`,
      `Mensaje del usuario: "${textoUsuario}"`
    ].join("\n");

    const response = await generarClasificacionIntencion({ system, user });
    const raw = String(response?.texto || "").trim();
    
    // Extraer JSON
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const intencion = String(parsed?.intencion || "").trim().toLowerCase();
      const validas = ["confirmar", "cancelar", "completar_datos", "comentario_adicional", "cambiar_tema"];
      if (validas.includes(intencion)) {
        return intencion;
      }
    }
  } catch (err) {
    console.error("[inventario_pendiente] Error en clasificación por IA:", err.message);
  }
  return null;
}

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerInventarioPendiente(ctx) {
  const usuarioId = ctx?.planCtx?.usuario?.id;
  if (!usuarioId) return { manejado: false };

  const pend = await obtenerPendiente(usuarioId);
  if (!pend) return { manejado: false };

  const consultaRaw = String(ctx.consulta || "");
  const descBorrador = obtenerDescripcionBorrador(pend);

  // 1. Clasificación por IA
  let intencion = await clasificarIntencionBorradorPendiente(consultaRaw, descBorrador);

  // 2. Fallback a heurísticas/regex en caso de que la clasificación por IA falle
  if (!intencion) {
    console.log("[inventario_pendiente] Fallback a heurísticas viejas por falta de clasificación");
    if (!esPedidoCancelarPendiente(consultaRaw) && esConsultaOtroDominioExplicita(consultaRaw)) {
      return { manejado: false };
    }
    intencion = esPedidoCancelarPendiente(consultaRaw) ? "cancelar" : "completar_datos";
  }

  console.log(`[inventario_pendiente] Intención clasificada: ${intencion}`);

  // 3. Si la intención es cambiar de tema, ceder turno
  if (intencion === "cambiar_tema") {
    return { manejado: false };
  }

  // 4. Mapear textos para el flujo legacy de inventario
  let textoParaFlow = consultaRaw;
  if (intencion === "confirmar") {
    textoParaFlow = "si";
  } else if (intencion === "cancelar") {
    textoParaFlow = "no";
  }

  const inv = await manejarInventarioWhatsapp({
    texto: textoParaFlow,
    usuarioId,
    numeroWhatsapp: normalizarWhatsapp(ctx.jid),
  });

  let respuesta = null;
  let routeFinal = "registrar_inventario_pendiente";
  if (inv?.manejado && inv.respuesta != null) {
    respuesta = inv.respuesta;
  } else {
    respuesta = construirRecordatorioPendiente(pend);
    routeFinal = "inventario_pendiente_recordatorio";
  }

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

module.exports = {
  handlerInventarioPendiente,
  clasificarIntencionBorradorPendiente,
  obtenerDescripcionBorrador,
};
