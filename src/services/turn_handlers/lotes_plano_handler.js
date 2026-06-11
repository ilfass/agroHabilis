"use strict";

/**
 * lotes_plano_handler.js — Flujo de confirmación para registro de lotes
 * extraídos de un plano catastral enviado como imagen/PDF.
 *
 * Flujo:
 * 1. El usuario envía una foto de un plano catastral.
 * 2. El pipeline detecta "[Análisis de archivo:" con palabras clave de plano.
 * 3. Se parsean los lotes del texto OCR y se guardan en conversacion_estado
 *    (flujo: "lotes_plano", paso: "esperando_confirmacion").
 * 4. Se responde listando los lotes y preguntando confirmación.
 * 5. Si el usuario confirma ("Si"), se registran todos con domain.register_lote.
 * 6. Si cancela ("No"), se limpia el estado.
 */

const { guardarEstado, obtenerEstado, limpiarEstado } = require("../conversacion_estado");
const { invokeTool } = require("../agent/tools");
const { obtenerPerfil } = require("../../models/usuario");
const { normalizarWhatsapp } = require("../../models/usuario");

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const FLUJO = "lotes_plano";
const PASO_ESPERANDO = "esperando_confirmacion";
// Lotes con superficie < MIN_HA_FILTRO se omiten (calles, molinos, piquetes)
const MIN_HA_FILTRO = 0.5;
// Prefijos de nombres no-productivos que se descartan
const PREFIJOS_NO_PRODUCTIVOS = /^(calle|mol\s*\d|piq\s*\d|molino|casco)/i;

// ─────────────────────────────────────────────────────────────────────────────
// Parser de lotes desde texto OCR del plano
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrae lotes de un texto OCR de plano catastral.
 * Reconoce líneas como:
 *   "- Lote 1: Potrero 31.89 | Agrícola 31.25"
 *   "Lote 7b: Potrero 12.40 | Agrícola 0.00"
 *   "Potrero Norte: 45,3 ha"
 *
 * @param {string} textoOcr
 * @returns {{ nombre: string, hectareas: number, hectareas_agricolas: number }[]}
 */
const parsearLotesDeOCR = (textoOcr) => {
  const lotes = [];
  const texto = String(textoOcr || "");

  // Patrón principal robusto: admite "Sup. Potrero = 46.28 ha | Sup. Agrícola = 45.33 ha" y "Potrero 20.24 | Agrícola 0.00"
  const regexCompleto = /[-•*]?\s*(Lote\s+[\w\s\-\.\/]+?|Potrero\s+[\w\s\-\.\/]+?):\s*(?:Sup\.\s+)?Potrero\s*(?:=\s*)?([\d.,]+)(?:\s*ha)?\s*[|]\s*(?:Sup\.\s+)?Agr[íi]cola\s*(?:=\s*)?([\d.,]+)(?:\s*ha)?/gi;
  let m;
  while ((m = regexCompleto.exec(texto)) !== null) {
    const nombre = m[1].trim().replace(/\s+/g, " ");
    const haPotrero = parseFloat(m[2].replace(",", ".")) || 0;
    const haAgricola = parseFloat(m[3].replace(",", ".")) || 0;

    // Filtrar no-productivos
    if (PREFIJOS_NO_PRODUCTIVOS.test(nombre)) continue;
    if (haPotrero < MIN_HA_FILTRO) continue;
    // Omitir fila TOTAL
    if (/^total$/i.test(nombre)) continue;

    lotes.push({
      nombre,
      hectareas: haPotrero,
      hectareas_agricolas: haAgricola,
    });
  }

  // Si el patrón completo no encontró nada, intentar patrón simple: "Lote X: NNN ha"
  if (lotes.length === 0) {
    const regexSimple = /[-•*]?\s*((?:Lote|Potrero|Campo)\s+[\w\s\-\.\/]+?):\s*(?:Sup\.\s+)?([\d.,]+)\s*ha?\b/gi;
    while ((m = regexSimple.exec(texto)) !== null) {
      const nombre = m[1].trim().replace(/\s+/g, " ");
      const ha = parseFloat(m[2].replace(",", ".")) || 0;
      if (PREFIJOS_NO_PRODUCTIVOS.test(nombre)) continue;
      if (ha < MIN_HA_FILTRO) continue;
      lotes.push({ nombre, hectareas: ha, hectareas_agricolas: 0 });
    }
  }

  return lotes;
};

// ─────────────────────────────────────────────────────────────────────────────
// Detección de plano catastral
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determina si el texto OCR corresponde a un plano catastral/mapa de lotes.
 * @param {string} texto
 * @returns {boolean}
 */
const esPlanoCatastral = (texto) => {
  const t = String(texto || "").toLowerCase();
  if (!t.includes("[análisis de archivo:") && !t.includes("[analisis de archivo:")) return false;

  return (
    t.includes("potrero") ||
    t.includes("plano catastral") ||
    t.includes("plano productivo") ||
    (t.includes("lote") && /\d+[.,]\d+\s*(ha|potrero)/i.test(texto)) ||
    t.includes("superficie de potreros") ||
    t.includes("medidas de alambrados")
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Detectar nombre del campo/establecimiento en el OCR
// ─────────────────────────────────────────────────────────────────────────────

const extraerNombreCampo = (textoOcr) => {
  // Ej: "Plano catastral y productivo del establecimiento 'Don Martín'"
  const m1 = textoOcr.match(/establecimiento\s+'([^']+)'/i);
  if (m1) return m1[1].trim();
  // Ej: "establecimiento \"Don Martín\""
  const m2 = textoOcr.match(/establecimiento\s+"([^"]+)"/i);
  if (m2) return m2[1].trim();
  // Ej: "campo Don Martín"
  const m3 = textoOcr.match(/\bcampo\s+([A-ZÁÉÍÓÚÑ][^\n,.(]+)/i);
  if (m3) return m3[1].trim();
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler principal: procesar plano catastral
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Llama a este handler cuando se detecta un plano catastral OCR.
 * Guarda los lotes en conversacion_estado y responde con la lista + confirmación.
 *
 * @param {{ textoOcr: string, usuarioId: number, numeroWhatsapp: string, nombreUsuario?: string }} opts
 * @returns {{ manejado: boolean, respuesta: string|null }}
 */
const procesarPlanoCatastral = async ({ textoOcr, usuarioId, numeroWhatsapp, nombreUsuario }) => {
  const lotes = parsearLotesDeOCR(textoOcr);
  const campo = extraerNombreCampo(textoOcr);

  if (lotes.length === 0) {
    return { manejado: false, respuesta: null };
  }

  const waClean = normalizarWhatsapp(numeroWhatsapp);
  const nombre = nombreUsuario ? String(nombreUsuario).split(" ")[0].trim() : "";
  const saludo = nombre ? `¡Hola ${nombre}! ` : "¡Hola! ";

  // Guardar en conversacion_estado con expiración de 4 horas
  await guardarEstado(
    waClean,
    FLUJO,
    PASO_ESPERANDO,
    {
      lotes,
      campo: campo || null,
      usuario_id: usuarioId,
    },
    4 // 4 horas para que Juan no pierda el estado
  );

  // Construir respuesta con lista de lotes
  const totalHa = lotes.reduce((s, l) => s + l.hectareas, 0).toFixed(2);
  const campoStr = campo ? ` del campo *${campo}*` : "";

  const filas = lotes
    .map((l) => {
      const agri = l.hectareas_agricolas > 0
        ? ` (${l.hectareas_agricolas.toFixed(2)} ha agrícolas)`
        : "";
      return `• *${l.nombre}*: ${l.hectareas.toFixed(2)} ha${agri}`;
    })
    .join("\n");

  const respuesta = [
    `${saludo}Analicé el plano catastral${campoStr} y encontré *${lotes.length} lotes* con una superficie total de *${totalHa} ha*:`,
    "",
    filas,
    "",
    `¿Querés que los registre *todos* en tu perfil de AgroHabilis? Respondé *Sí* para confirmar o *No* para cancelar.`,
  ].join("\n");

  return { manejado: true, respuesta };
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler de confirmación: el usuario respondió "Si" o "No"
// ─────────────────────────────────────────────────────────────────────────────

const PATRONES_CONFIRMACION = /^(si|sí|sii|siis|dale|ok|sip|claro|confirmo|confirmar|todo|todos|si a todo|registralos|registrálos|cargalos|cargálos|anotalos|anótalos|adelante|listo|va|buenísimo|genial|perfecto)$/i;
const PATRONES_CANCELACION = /^(no|nop|nope|cancelar|cancela|olvidalo|olvidate|olvidalo|no gracias|para|paren|detener|ninguno|ningún|omitir)$/i;

/**
 * Maneja la confirmación/cancelación del usuario cuando hay un estado de lotes pendientes.
 *
 * @param {{ textoPregunta: string, estadoPlano: object, usuarioId: number, numeroWhatsapp: string, nombreUsuario?: string }} opts
 * @returns {{ manejado: boolean, respuesta: string|null }}
 */
const manejarConfirmacionLotesPlano = async ({
  textoPregunta,
  estadoPlano,
  usuarioId,
  numeroWhatsapp,
  nombreUsuario,
}) => {
  const t = String(textoPregunta || "").trim();
  const esConfirmacion = PATRONES_CONFIRMACION.test(t);
  const esCancelacion = PATRONES_CANCELACION.test(t);

  if (!esConfirmacion && !esCancelacion) {
    return { manejado: false, respuesta: null };
  }

  const waClean = normalizarWhatsapp(numeroWhatsapp);
  await limpiarEstado(waClean);

  if (esCancelacion) {
    const nombre = nombreUsuario ? String(nombreUsuario).split(" ")[0].trim() : "";
    const saludo = nombre ? `${nombre}, ` : "";
    return {
      manejado: true,
      respuesta: `Entendido, ${saludo}no registré ningún lote. Si en algún momento querés cargarlos, mandale la foto del plano o decime los datos de cada lote y los doy de alta.`,
    };
  }

  // Confirmar → registrar todos los lotes con domain.register_lote
  const { lotes, campo } = estadoPlano.contexto || {};

  if (!Array.isArray(lotes) || lotes.length === 0) {
    return {
      manejado: true,
      respuesta: "No encontré los lotes guardados. Por favor, mandame el plano de nuevo para procesarlo.",
    };
  }

  // Buscar perfil actualizado (para pasar usuario completo al tool)
  const usuario = await obtenerPerfil(waClean).catch(() => ({ id: usuarioId }));

  // Llamar a domain.register_lote con todos los lotes
  let resultadoTool;
  try {
    const lotesArgs = lotes.map((l) => ({
      nombre: l.nombre,
      hectareas: l.hectareas,
      cliente: campo || undefined,
    }));

    resultadoTool = await invokeTool("domain.register_lote", { lotes: lotesArgs }, { usuario });
  } catch (err) {
    console.error("[lotes_plano_handler] Error al invocar domain.register_lote:", err.message);
    return {
      manejado: true,
      respuesta: `Hubo un problema al registrar los lotes: ${err.message}. Por favor intentalo de nuevo en unos minutos.`,
    };
  }

  const textoTool = String(resultadoTool?.texto || "").trim();
  const nombre = nombreUsuario ? String(nombreUsuario).split(" ")[0].trim() : "";

  if (textoTool) {
    return { manejado: true, respuesta: textoTool };
  }

  const campoStr = campo ? ` del campo *${campo}*` : "";
  return {
    manejado: true,
    respuesta: `✅ ¡Listo${nombre ? `, ${nombre}` : ""}! Registré los *${lotes.length} lotes*${campoStr} en tu perfil de AgroHabilis. Ya los podés ver en el panel y asociar movimientos.`,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  esPlanoCatastral,
  parsearLotesDeOCR,
  procesarPlanoCatastral,
  manejarConfirmacionLotesPlano,
  FLUJO,
  PASO_ESPERANDO,
};
