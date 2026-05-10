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
    "",
    "Schema obligatorio:",
    '{"intencion":"registro_inventario"|null,"dominio":"ganado"|"cultivo"|"grano"|"insumo"|null,"efecto":"replace"|"delta",',
    '"cantidad_cabezas": number|null,"delta_cabezas": number|null,"hectareas": number|null,"delta_hectareas": number|null,',
    '"toneladas_grano": number|null,"delta_toneladas": number|null,',
    '"producto_insumo": string|null,"unidad_insumo": string|null,"cantidad_insumo": number|null,"delta_insumo": number|null,',
    '"categoria_ganado": string|null,"cultivo": string|null,"especie": string|null,',
    '"lote_nombre_libre": string|null,"campana_nombre_libre": string|null,',
    '"fecha_referencia": "YYYY-MM-DD"|null}',
    "",
    "Reglas:",
    "- efecto=delta sólo cuando el texto indica variación respecto del stock anterior (consumo, entrada, +/-). De lo contrario replace.",
    "- ganado replace: cantidad_cabezas entero positivo; delta: delta_cabezas entero (negativo si salida/consumo).",
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
  if (!j || j.intencion !== "registro_inventario") return null;
  const dom = String(j.dominio || "").toLowerCase();
  const fechaReferencia =
    typeof j.fecha_referencia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.fecha_referencia.trim())
      ? j.fecha_referencia.trim()
      : fechaHoy;
  const efectoLlm = String(j.efecto || "replace").trim().toLowerCase() === "delta" ? "delta" : "replace";

  if (dom === "ganado") {
    const catRaw = String(j.categoria_ganado || "").trim() || "cabezas";
    const especie = String(j.especie || "").trim() || inferirEspecieDesdeEtiqueta(catRaw);
    if (efectoLlm === "delta") {
      const d = Number(j.delta_cabezas);
      if (!Number.isFinite(d) || !Number.isInteger(Math.round(d))) return null;
      return {
        tipo: "registro",
        dominio: "ganado",
        efecto: "delta",
        payload: { especie, categoria: catRaw.slice(0, 80), delta: Math.round(d) },
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
      payload: { especie, categoria: catRaw.slice(0, 80), cantidad: Math.round(n) },
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

module.exports = {
  inventarioLlmHabilitado,
  permiteIntentarLlmTrasFalloHeuristica,
  borradorRegistroDesdeLlm,
};
