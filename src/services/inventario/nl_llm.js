"use strict";

const { generarClasificacionIntencion } = require("../gemini");
const { fechaISOArgentina } = require("../../utils/fecha_ar");
const { inferirEspecieDesdeEtiqueta, normalizarUnidadInsumo } = require("./core");

const extraerJson = (texto = "") => {
  const match = String(texto).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_e) {
    return null;
  }
};

const inventarioLlmHabilitado = () => {
  const v = String(process.env.INVENTARIO_NL_LLM || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return Boolean(process.env.GEMINI_API_KEY?.trim());
};

/** Señales débiles: hay número + vocabulario campo; sin pedido de precio de mercado. */
const norm = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const permiteIntentarLlmTrasFalloHeuristica = (texto = "") => {
  if (!/\d/.test(String(texto || ""))) return false;
  const t = norm(texto);
  if (/\b(precio|cotiza|valor|usd|usd\/tn|usd\s*\/\s*tn|\$)/.test(texto || "")) return false;
  if (/\bcuánto\b.*\best(á|a|aba)\b/.test(t)) return false;
  return /\b(lote|parcela|campo|cabeza|cabez|cabs|cab\.|vacas|novillos|terneros|ganad|stock|ha\b|has\b|hectarea|soja|ma[ií]z|trigo|campa[nñ]a|inventario|registr|guard|carg|urea|insumo|litro|glif|fertil|\bkg\b|bolsa|\btn\b|toneladas?)/.test(
    texto || ""
  );
};

/**
 * Convierte el JSON de extracción (intencion registro_inventario) al borrador interno de inventario.
 */
function mapearJsonARegistroBorrador(j, textoUsuario) {
  if (!j || j.intencion !== "registro_inventario") return null;
  const fechaHoy = fechaISOArgentina();
  const dom = String(j.dominio || "").toLowerCase();
  const fechaReferencia =
    typeof j.fecha_referencia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.fecha_referencia.trim())
      ? j.fecha_referencia.trim()
      : fechaHoy;
  const efectoLlm = String(j.efecto || "replace").trim().toLowerCase() === "delta" ? "delta" : "replace";

  if (dom === "ganado") {
    const catRaw = String(j.categoria_ganado || "").trim() || "cabezas";
    const especie = String(j.especie || "").trim() || inferirEspecieDesdeEtiqueta(catRaw);
    const ind = Array.isArray(j.animales_individuales) && j.animales_individuales.length > 0 ? j.animales_individuales : undefined;
    
    if (efectoLlm === "delta") {
      const d = Number(j.delta_cabezas);
      if (!Number.isFinite(d) || !Number.isInteger(Math.round(d))) return null;
      return {
        tipo: "registro",
        dominio: "ganado",
        efecto: "delta",
        payload: { especie, categoria: catRaw.slice(0, 80), delta: Math.round(d), animales_individuales: ind },
        lote_nombre_fragmento: j.lote_nombre_libre ? String(j.lote_nombre_libre).trim().slice(0, 80) || null : null,
        campana_nombre_fragmento: j.campana_nombre_libre
          ? String(j.campana_nombre_libre).trim().slice(0, 80) || null
          : null,
        fecha_referencia: fechaReferencia,
        texto_original: String(textoUsuario || ""),
        _via_llm: true,
      };
    }
    const n = Number(j.cantidad_cabezas);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(Math.round(n))) return null;
    return {
      tipo: "registro",
      dominio: "ganado",
      efecto: "replace",
      payload: { especie, categoria: catRaw.slice(0, 80), cantidad: Math.round(n), animales_individuales: ind },
      lote_nombre_fragmento: j.lote_nombre_libre ? String(j.lote_nombre_libre).trim().slice(0, 80) || null : null,
      campana_nombre_fragmento: j.campana_nombre_libre
        ? String(j.campana_nombre_libre).trim().slice(0, 80) || null
        : null,
      fecha_referencia: fechaReferencia,
      texto_original: String(textoUsuario || ""),
      _via_llm: true,
    };
  }

  if (dom === "grano") {
    const cultivo = String(j.cultivo || "").trim();
    if (!cultivo) return null;
    if (efectoLlm === "delta") {
      const dt = Number(j.delta_toneladas);
      if (!Number.isFinite(dt)) return null;
      return {
        tipo: "registro",
        dominio: "grano",
        efecto: "delta",
        payload: { cultivo: cultivo.slice(0, 80), delta: dt },
        lote_nombre_fragmento: j.lote_nombre_libre ? String(j.lote_nombre_libre).trim().slice(0, 80) || null : null,
        campana_nombre_fragmento: j.campana_nombre_libre
          ? String(j.campana_nombre_libre).trim().slice(0, 80) || null
          : null,
        fecha_referencia: fechaReferencia,
        texto_original: String(textoUsuario || ""),
        _via_llm: true,
      };
    }
    const tn = Number(j.toneladas_grano);
    if (!Number.isFinite(tn) || tn < 0) return null;
    return {
      tipo: "registro",
      dominio: "grano",
      efecto: "replace",
      payload: { cultivo: cultivo.slice(0, 80), toneladas: tn },
      lote_nombre_fragmento: j.lote_nombre_libre ? String(j.lote_nombre_libre).trim().slice(0, 80) || null : null,
      campana_nombre_fragmento: j.campana_nombre_libre
        ? String(j.campana_nombre_libre).trim().slice(0, 80) || null
        : null,
      fecha_referencia: fechaReferencia,
      texto_original: String(textoUsuario || ""),
      _via_llm: true,
    };
  }

  if (dom === "cultivo") {
    const cultivo = String(j.cultivo || "").trim();
    if (!cultivo) return null;
    if (efectoLlm === "delta") {
      const dh = Number(j.delta_hectareas);
      if (!Number.isFinite(dh)) return null;
      return {
        tipo: "registro",
        dominio: "cultivo",
        efecto: "delta",
        payload: { cultivo: cultivo.slice(0, 80), delta: dh },
        lote_nombre_fragmento: j.lote_nombre_libre ? String(j.lote_nombre_libre).trim().slice(0, 80) || null : null,
        campana_nombre_fragmento: j.campana_nombre_libre
          ? String(j.campana_nombre_libre).trim().slice(0, 80) || null
          : null,
        fecha_referencia: fechaReferencia,
        texto_original: String(textoUsuario || ""),
        _via_llm: true,
      };
    }
    const ha = Number(j.hectareas);
    if (!Number.isFinite(ha) || ha <= 0) return null;
    return {
      tipo: "registro",
      dominio: "cultivo",
      efecto: "replace",
      payload: { cultivo: cultivo.slice(0, 80), hectareas: ha },
      lote_nombre_fragmento: j.lote_nombre_libre ? String(j.lote_nombre_libre).trim().slice(0, 80) || null : null,
      campana_nombre_fragmento: j.campana_nombre_libre
        ? String(j.campana_nombre_libre).trim().slice(0, 80) || null
        : null,
      fecha_referencia: fechaReferencia,
      texto_original: String(textoUsuario || ""),
      _via_llm: true,
    };
  }

  if (dom === "insumo") {
    const producto = String(j.producto_insumo || "").trim().slice(0, 120);
    const unidad = normalizarUnidadInsumo(j.unidad_insumo);
    if (!producto) return null;
    if (efectoLlm === "delta") {
      const din = Number(j.delta_insumo);
      if (!Number.isFinite(din)) return null;
      return {
        tipo: "registro",
        dominio: "insumo",
        efecto: "delta",
        payload: { producto, delta: din, unidad },
        lote_nombre_fragmento: j.lote_nombre_libre ? String(j.lote_nombre_libre).trim().slice(0, 80) || null : null,
        campana_nombre_fragmento: j.campana_nombre_libre
          ? String(j.campana_nombre_libre).trim().slice(0, 80) || null
          : null,
        fecha_referencia: fechaReferencia,
        texto_original: String(textoUsuario || ""),
        _via_llm: true,
      };
    }
    const q = Number(j.cantidad_insumo);
    if (!Number.isFinite(q) || q <= 0) return null;
    return {
      tipo: "registro",
      dominio: "insumo",
      efecto: "replace",
      payload: { producto, cantidad: q, unidad },
      lote_nombre_fragmento: j.lote_nombre_libre ? String(j.lote_nombre_libre).trim().slice(0, 80) || null : null,
      campana_nombre_fragmento: j.campana_nombre_libre
        ? String(j.campana_nombre_libre).trim().slice(0, 80) || null
        : null,
      fecha_referencia: fechaReferencia,
      texto_original: String(textoUsuario || ""),
      _via_llm: true,
    };
  }

  return null;
}

async function borradorRegistroDesdeLlm(textoUsuario, { lotes = [], campanas = [], forzarCapaUsuario = false } = {}) {
  const llmOk =
    inventarioLlmHabilitado() || (Boolean(forzarCapaUsuario) && Boolean(process.env.GEMINI_API_KEY?.trim()));
  if (!llmOk) return null;
  const fechaHoy = fechaISOArgentina();
  const lotesBrief = lotes.slice(0, 30).map((l) => ({ id: l.id, nombre: l.nombre }));
  const campBrief = campanas.slice(0, 20).map((c) => ({ id: c.id, nombre: c.nombre }));
  const system = [
    "Extracción estructurada para inventario de campo (Argentina). Respondé SOLO un JSON válido, sin markdown ni texto extra.",
    "Si el mensaje NO es cargar/stock de ganado (cabezas), cultivo (hectáreas), grano (stock físico en tn de cereal/oleaginosa) o insumo (kg, litros, bolsas…), devolvé {\"intencion\":null}.",
    "Si es un listado o planilla con VARIOS encabezados tipo «Lote 1.», «Lote 2a.», «Lote 3.» (remate, inventario por lote, repaso de cabezas por campo) y no es UN solo pedido de alta/reemplazo concreto, devolvé {\"intencion\":null}: no inventes un solo lote ni sumes cabezas de todo el texto.",
    "Si el productor solo describe o reparte hacienda entre lotes sin un verbo claro de «registrá/guardá/cargá» para UNA operación, preferí {\"intencion\":null}.",
    "",
    "Schema obligatorio:",
    '{"intencion":"registro_inventario"|null,"dominio":"ganado"|"cultivo"|"grano"|"insumo"|null,"efecto":"replace"|"delta",',
    '"cantidad_cabezas": number|null,"delta_cabezas": number|null,"hectareas": number|null,"delta_hectareas": number|null,',
    '"toneladas_grano": number|null,"delta_toneladas": number|null,',
    '"producto_insumo": string|null,"unidad_insumo": string|null,"cantidad_insumo": number|null,"delta_insumo": number|null,',
    '"categoria_ganado": string|null,"cultivo": string|null,"especie": string|null,',
    '"animales_individuales": [{"caravana": string|null, "categoria": string, "estado": "sano"|"enfermo"|"vacunado"|"muerto"|"otro", "observaciones": string|null}]|null,',
    '"lote_nombre_libre": string|null,"campana_nombre_libre": string|null,',
    '"fecha_referencia": "YYYY-MM-DD"|null}',
    "",
    "Reglas:",
    "- ganado replace: cantidad_cabezas entero positivo; delta: delta_cabezas entero (negativo si salida/consumo).",
    "- animales_individuales: SOLO si el productor detalla uno a uno o pide registrar el estado de animales específicos (enfermos, con caravana, vacunados, etc.).",
    "- cultivo replace: hectareas > 0; delta: delta_hectareas número (podés usar negativo).",
    "- grano: stock en TN (toneladas) de un cultivo (soja, maíz, trigo…). NO confundir con hectáreas. replace: toneladas_grano; delta: delta_toneladas (negativo si venta/salida).",
    "- insumo: producto_insumo y unidad_insumo (ej kg, lt, bolsa); replace usa cantidad_insumo; delta usa delta_insumo.",
    "- lote_nombre_libre y campana_nombre_libre cuando existan.",
    "- fecha_referencia sólo día explícito; si no, null.",
    "- No inventes cifras: si no están en el texto, intencion null.",
  ].join("\n");

  const user = [
    `fecha_hoy_ar: ${fechaHoy}`,
    `lotes_catalogo_json: ${JSON.stringify(lotesBrief)}`,
    `campanas_catalogo_json: ${JSON.stringify(campBrief)}`,
    `mensaje_productor: """${String(textoUsuario || "").slice(0, 900)}"""`,
    "Devolvé el JSON:",
  ].join("\n");

  let raw;
  try {
    ({ texto: raw } = await generarClasificacionIntencion({ system, user }));
  } catch (_e) {
    return null;
  }
  const j = extraerJson(raw || "");
  return mapearJsonARegistroBorrador(j, textoUsuario);
}

/**
 * Un solo paso estilo asistente: decide si es registro, consulta de stock, charla guía, o no es inventario WhatsApp.
 * @param {"registro"|"consulta"|null} [modoForzado] — acota el comportamiento cuando el pipeline ya fijó la capa.
 * @returns {null|{ accion: "registro", borrador: object }|{ accion: "consulta", consulta_filtro_lote: string|null, mensaje_preludio: string|null }|{ accion: "conversacion", respuesta: string }|{ accion: "no_inventario" }}
 */
async function interpretarInventarioAgenteWhatsApp(
  textoUsuario,
  { lotes = [], campanas = [], forzarCapaUsuario = false, modoForzado = null } = {}
) {
  const llmOk =
    inventarioLlmHabilitado() || (Boolean(forzarCapaUsuario) && Boolean(process.env.GEMINI_API_KEY?.trim()));
  if (!llmOk) return null;

  const { esPlanillaCatalogoLotesMultiples } = require("./nl_heuristica");
  const fechaHoy = fechaISOArgentina();
  const lotesBrief = lotes.slice(0, 30).map((l) => ({ id: l.id, nombre: l.nombre }));
  const campBrief = campanas.slice(0, 20).map((c) => ({ id: c.id, nombre: c.nombre }));

  const system = [
    "Sos el asistente de inventario de AgroHabilis por WhatsApp (productores argentinos).",
    "Pensá como un agente útil (estilo asistente en chat): interpretá la intención en un solo paso, sin sonar a formulario rígido.",
    "Respondé SOLO un JSON válido (un objeto raíz), sin markdown ni texto fuera del JSON.",
    "",
    "Campo obligatorio raíz:",
    '"accion": "registro" | "consulta" | "conversacion" | "no_inventario"',
    "",
    "— accion = no_inventario: el mensaje no va por este módulo (precio de mercado, clima, saludo, u otro tema). mensaje null.",
    "— accion = conversacion: explicá en español rioplatense qué entendiste y qué podés hacer o qué falta (ej. planilla de muchos lotes, datos incompletos, mezcla consulta+alta). Campo obligatorio: mensaje (string, tono WhatsApp, *negritas* opcionales).",
    "— accion = consulta: el productor quiere ver stock/inventario cargado. consulta_filtro_lote: nombre o fragmento de lote si lo menciona, o null para ver todo. mensaje: opcional, 1–2 líneas de intro antes de los datos (o null).",
    "— accion = registro: una sola operación de alta o delta de ganado (cabezas), cultivo (ha), grano (tn) o insumo. Objeto obligatorio registro con el MISMO schema interno:",
    '{"dominio":"ganado"|"cultivo"|"grano"|"insumo","efecto":"replace"|"delta",',
    '"cantidad_cabezas": number|null,"delta_cabezas": number|null,"hectareas": number|null,"delta_hectareas": number|null,',
    '"toneladas_grano": number|null,"delta_toneladas": number|null,',
    '"producto_insumo": string|null,"unidad_insumo": string|null,"cantidad_insumo": number|null,"delta_insumo": number|null,',
    '"categoria_ganado": string|null,"cultivo": string|null,"especie": string|null,',
    '"animales_individuales": [{"caravana": string|null, "categoria": string, "estado": string, "observaciones": string|null}]|null,',
    '"lote_nombre_libre": string|null,"campana_nombre_libre": string|null,"fecha_referencia":"YYYY-MM-DD"|null}',
    "Si no podés armar un registro válido sin inventar cifras, usá accion conversacion con mensaje claro (no uses registro vacío).",
    "",
    "Reglas de negocio:",
    "- Listados tipo remate con muchos «Lote 1.», «Lote 2a.» y varias categorías: accion conversacion (no registro único, no no_inventario salvo que sea claramente otro tema).",
    "- Si mezclás consulta de «qué tengo» y «guardá X» en el mismo mensaje: conversacion pidiendo separar en dos mensajes.",
    "- Compará lote_nombre_libre con lotes_catalogo_json (nombres); si no coincide, igual podés devolver registro con el nombre libre (el sistema resuelve o pregunta).",
    "- No inventes números; no sumes cabezas de toda una planilla en un solo registro.",
    "",
    "modo_forzado en el user JSON:",
    '- Si viene "consulta": solo consulta o conversacion (nunca registro).',
    '- Si viene "registro": solo registro o conversacion pidiendo dato faltante (nunca no_inventario).',
    '- Si null: libertad total.',
  ].join("\n");

  const user = [
    `fecha_hoy_ar: ${fechaHoy}`,
    `modo_forzado: ${modoForzado == null ? "null" : JSON.stringify(modoForzado)}`,
    `lotes_catalogo_json: ${JSON.stringify(lotesBrief)}`,
    `campanas_catalogo_json: ${JSON.stringify(campBrief)}`,
    `mensaje_productor: """${String(textoUsuario || "").slice(0, 900)}"""`,
    "Devolvé solo el JSON raíz con accion y los campos que correspondan.",
  ].join("\n");

  let raw;
  try {
    ({ texto: raw } = await generarClasificacionIntencion({ system, user }));
  } catch (_e) {
    return null;
  }
  const u = extraerJson(raw || "");
  if (!u || typeof u.accion !== "string") return null;

  const acc = String(u.accion)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (acc === "no_inventario") return { accion: "no_inventario" };

  if (acc === "conversacion") {
    const msg = String(u.mensaje || "").trim();
    if (!msg) return { accion: "no_inventario" };
    return { accion: "conversacion", respuesta: msg };
  }

  if (acc === "consulta") {
    const lot =
      u.consulta_filtro_lote != null && String(u.consulta_filtro_lote).trim()
        ? String(u.consulta_filtro_lote).trim().slice(0, 80)
        : null;
    const mensaje = u.mensaje != null && String(u.mensaje).trim() ? String(u.mensaje).trim() : null;
    return { accion: "consulta", consulta_filtro_lote: lot, mensaje_preludio: mensaje };
  }

  if (acc === "registro") {
    const reg = u.registro && typeof u.registro === "object" ? u.registro : null;
    if (!reg) {
      const msg = String(u.mensaje || "").trim();
      return {
        accion: "conversacion",
        respuesta:
          msg ||
          "Para guardar en inventario necesito un solo dato claro (cabezas, hectáreas, tn de grano o insumo con cantidad). ¿Qué querés registrar?",
      };
    }
    const j = { intencion: "registro_inventario", ...reg };
    const borrador = mapearJsonARegistroBorrador(j, textoUsuario);
    if (!borrador) {
      const msg = String(u.mensaje || "").trim();
      return {
        accion: "conversacion",
        respuesta:
          msg ||
          "No me cierra un solo registro con cifras claras (cabezas, ha, tn o insumo). Decime en una frase qué guardar y en qué lote o campo.",
      };
    }
    if (esPlanillaCatalogoLotesMultiples(String(textoUsuario || ""))) {
      const msg = String(u.mensaje || "").trim();
      return {
        accion: "conversacion",
        respuesta:
          msg ||
          "Eso lo leo como *varios lotes* en un mismo mensaje (planilla o remate). Desde WhatsApp no importo todo junto: podés cargar *un lote por mensaje* o usar *Mi Panel* → Inventario. Si querés, empezamos por el primero que quieras dar de alta.",
      };
    }
    return { accion: "registro", borrador };
  }

  return null;
}

module.exports = {
  inventarioLlmHabilitado,
  permiteIntentarLlmTrasFalloHeuristica,
  borradorRegistroDesdeLlm,
  interpretarInventarioAgenteWhatsApp,
  mapearJsonARegistroBorrador,
};
