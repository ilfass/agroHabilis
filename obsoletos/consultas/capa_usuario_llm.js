"use strict";

/**
 * Router opt-in por LLM (Gemini JSON): clasifica inventario vs perfil vs mercado/general.
 * Con CONSULTA_CAPA_USUARIO_LLM=1 corre *antes* de la heurística de inventario en legacy,
 * así precios/consultas de mercado no pasan por reglas locales frágiles.
 *
 * Habilitar: CONSULTA_CAPA_USUARIO_LLM=1 y GEMINI_API_KEY.
 */

const { generarClasificacionIntencion } = require("../gemini");

const extraerJson = (texto = "") => {
  const raw = String(texto || "").trim();
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(raw.slice(i, j + 1));
  } catch (_e) {
    return null;
  }
};

const normalizarMinus = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function capaUsuarioRouterHabilitado() {
  const v = String(process.env.CONSULTA_CAPA_USUARIO_LLM || "").trim().toLowerCase();
  const on = v === "1" || v === "true" || v === "on";
  return on && Boolean(process.env.GEMINI_API_KEY?.trim());
}

/** Evita Gemini en confirmaciones muy cortas. */
function esMensajeMuyBreveNeutral(texto = "") {
  const t = String(texto || "").trim();
  if (!t || t.length > 12) return false;
  const n = normalizarMinus(t.replace(/[!?¿¡.,;:]/g, ""));
  return /^(si|s[ií]|no|nop|ok|dale|sip)$/i.test(n);
}

/** Respuesta cuando la capa es "mis_datos" / perfil de cultivos cargados por el usuario. */
function formatoRespuestaMisDatosPerfil(usuario) {
  const cults = (usuario?.cultivos || []).filter((x) => x?.cultivo);
  const zonaParts = [];
  if (usuario?.provincia) zonaParts.push(String(usuario.provincia));
  if (usuario?.partido) zonaParts.push(String(usuario.partido));
  const zona = zonaParts.length ? zonaParts.join(", ") : null;

  if (!cults.length) {
    return (
      `No encuentro cultivos cargados en tu perfil en Agro Habilis.\n` +
      `Podés completarlos con *COMPLETAR PERFIL* o desde *Mi Panel* web.\n` +
      `Para stocks por campo (cabezas / ha por lote / insumos) usá también *consultá inventario* o frases como «¿qué tengo cargado en inventario?».`
    );
  }

  const lineas = cults.map((c) => `🌾 *${String(c.cultivo).trim()}*${c.hectareas != null ? `: ${c.hectareas} ha en perfil` : ""}`);
  const z = zona ? `\n📍 Zona: *${zona}*.` : "";
  return [
    "*Según tu perfil (base interna de usuario)*",
    lineas.join("\n"),
    z,
    "",
    "_Tu inventario operativo por lote puede ser distinto: si cargaste movimientos de inventario, pedí_* consultá inventario _o*_ inventario _para ver saldos.",
  ].join("\n");
}

/**
 * Clasificación en JSON cerrado para enrutar legacy tras fallo inventario heurística.
 * @returns {Promise<{ capa: string, inventario_modo: string|null }|null>}
 */
async function clasificarCapaUsuarioMensaje(textoUsuario = "") {
  const input = String(textoUsuario || "").trim().slice(0, 450);
  if (!input || !capaUsuarioRouterHabilitado()) return null;

  const system = [
    "Clasificación de canal para productor argentino. Respondé SOLO JSON válido, sin texto extra.",
    "",
    '{"capa":"inventario|mis_datos|mercado_cotizacion|mercado_analisis|general","inventario_modo":"registro|consulta|null"}',
    "",
    "capa:",
    "- inventario: cargar/consultar existencias OPERATIVAS del campo por lote/establecimiento (cabezas, ha cultivadas ahí, insumos, stock de grano en tn, alta con confirmación). Incluye “sembré”, “guardé”, “registrá”, números en letras, “¿qué tengo cargado/inventario?”.",
    "- mis_datos: cultivos/hectáreas registrados en el PERFIL del sistema (tabla de usuario), p. ej. “qué cultivos tengo dados de alta en mi perfil”, “listá lo que declaré en mi cuenta”.",
    "- inventario + consulta: “qué tengo sembrado”, “qué hay en el lote/campo”, “mi inventario”, “stock en X” → inventario_modo consulta.",
    "- mercado_cotizacion: precios hoy por tableros, MAGYP/BCR, última rueda.",
    '- mercado_analisis: "me conviene vender/comprar?", estrategia, carry, recomendaciones con datos de mercado combinados.',
    "- general: charla sin lo anterior.",
    "",
    "inventario_modo:",
    '- Si capa=inventario y el usuario AGREGA datos o relata alta → "registro".',
    '- Si capa=inventario y el usuario SOLICITA estado/listado/consulta → "consulta".',
    "- Si capa≠inventario → null.",
    "",
    "Ante duda entre perfil vs inventario: si la pregunta es sobre qué hay sembrado/cargado en el campo o qué stock tenés → inventario consulta. Si explícitamente es perfil/cuenta declarada → mis_datos.",
    "",
    "Prioridad ante frases ambiguas o coloquiales:",
    '- Si pedís *precio*, cotización, valor/kg, tableros, MAG/BCR/remates, última rueda, "¿a cuánto está?" sobre mercado público → mercado_cotizacion.',
    '- Si pedís consejo de venta/compra/inversión estrategia "me conviene" con mercado → mercado_analisis.',
    '- Si el foco principal es declarar alta de existencias ya vinculadas al campo ("puse cargué metí entraron sembré guardé tantas vacas/soja tn/ha/insumo en lote"), aunque nombremos zona o raza, → inventario registro/consulta según aplique.',
    '- Mezcla larga consejo económico + contexto ganadero sin pedido explícito de guardar en inventario → mercado_analisis o general.',
  ].join("\n");

  const user = `mensaje_usuario:\n"""${input}"""`;

  try {
    const { texto } = await generarClasificacionIntencion({ system, user });
    const j = extraerJson(texto || "");
    if (!j) return null;
    const capasValidas = new Set(["inventario", "mis_datos", "mercado_cotizacion", "mercado_analisis", "general"]);
    const capa = capasValidas.has(String(j.capa || "").trim()) ? String(j.capa).trim() : "general";
    let inventario_modo =
      capa === "inventario" && ["registro", "consulta"].includes(String(j.inventario_modo || "").trim())
        ? String(j.inventario_modo).trim()
        : null;
    if (capa !== "inventario") inventario_modo = null;
    else if (!inventario_modo) inventario_modo = "registro"; // seguridad ante respuesta incompleta
    return { capa, inventario_modo };
  } catch (_e) {
    return null;
  }
}

module.exports = {
  capaUsuarioRouterHabilitado,
  clasificarCapaUsuarioMensaje,
  formatoRespuestaMisDatosPerfil,
  esMensajeMuyBreveNeutral,
};
