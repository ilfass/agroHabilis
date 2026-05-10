"use strict";

const normMin = (texto = "") =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const sanitizarPlaceholders = (texto = "") => {
  let t = String(texto || "");
  if (!t.trim()) return t;
  t = t.replace(/\bsin datos en base\b/gi, "sin dato puntual hoy");
  t = t.replace(/(^|[\s(])s\/d(?=$|[\s).,:;])/gi, "$1sin dato hoy");
  return t.replace(/\n{3,}/g, "\n\n").trim();
};

const tieneBloqueComplementoWeb = (texto = "") =>
  /🌐\s*\*Complemento web\*|Referencias web\s*\(/i.test(String(texto || ""));

/**
 * Regla general de producto: si la respuesta interna indica que no hay dato en base/sistema,
 * el pipeline debe complementar con búsqueda web (Gemini grounding).
 * Mantener patrones aquí para un solo lugar de verdad.
 */
const respuestaIndicaCarenciaDatosInternos = (texto = "") => {
  const raw = String(texto || "").trim();
  if (!raw) return false;
  if (tieneBloqueComplementoWeb(raw)) return false;
  const t = raw;
  const low = raw.toLowerCase();
  if (/\bsin datos en base\b/i.test(t)) return true;
  if (/\bsin dato(s)?\s+(en|de)\s+(la\s+)?base\b/i.test(t)) return true;
  if (/\bsin dato puntual(\s+hoy)?\b/i.test(t)) return true;
  if (/\bsin dato en base\b/i.test(t)) return true;
  if (/\breferencia puntual no informada\b/i.test(t)) return true;
  if (/\bsin esta información técnica\b/i.test(t)) return true;
  if (/\bno (es )?posible emitir\b/i.test(t)) return true;
  if (/\bactualmente\s+hay\s+sin datos\b/i.test(low)) return true;
  if (/\bno tengo\s+(el\s+)?dato\b/i.test(low) && /\b(base|tabla|interno|bd|sistema)/i.test(t)) return true;
  if (/\bno hay\s+(datos|dato)\s+(en|disponibles en)\b/i.test(low) && /\b(base|tabla|sistema)/i.test(t)) return true;
  if (/\bno disponible(s)?\s+en\s+(la\s+)?base\b/i.test(t)) return true;
  if (/\bsin información\s+(técnica|disponible)\s+para\b/i.test(t)) return true;
  if (/\bdatos?:\s*n\.?d\.|datos?:\s*s\/d\b/i.test(low)) return true;
  if (/\bDATO[_\s]*REAL:\s*(no_data|NO_DATA|vac[ií]o|null)\b/i.test(t)) return true;
  if (/\bNO_DATA\b|\(no_data\)/i.test(t)) return true;
  if (/\bpron[oó]stico\b/i.test(t) && /\b(sin datos|no disponible|no hay dato)\b/i.test(low)) return true;
  if (/\bsin datos de\b/i.test(t) && /\b(clima|pron[oó]stico|precio|mercado|cotiz)\b/i.test(t)) return true;
  return false;
};

const esRespuestaSecaSinDatos = (texto = "") => {
  const raw = String(texto || "").trim();
  const t = raw.toLowerCase();
  if (!t) return false;
  if (/^-?\s*sin datos en base[\s.!]*$/.test(t)) return true;
  if (/^-?\s*no tengo datos para eso[\s.!]*$/.test(t)) return true;
  if (
    /\bsin datos en base\b/.test(t) &&
    /(no dispongo|no tengo|sin valores|sin dato)/.test(t) &&
    /(pizarra|fob|precio)/.test(t)
  ) {
    return true;
  }
  if (/\bsin datos en base\b/.test(t)) {
    const lineas = raw
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    const tieneAccion = /recomendaci[oó]n|conviene|vender|esperar|parcial|te aviso|contexto|sugerencia/i.test(raw);
    if (lineas.length <= 5 && !tieneAccion) return true;
  }
  if (/^no_data\b/.test(t)) return true;
  if (t.includes("(no_data)")) return true;
  if (/^no tengo\b/.test(t)) {
    const lineas = raw.split("\n").map((x) => x.trim()).filter(Boolean);
    const tieneRecomendacion = /recomendaci[oó]n|conviene|vender|esperar|parcial|te aviso|contexto/i.test(raw);
    if (lineas.length <= 2 && !tieneRecomendacion) return true;
  }
  return false;
};

const esRespuestaNoConfiable = (texto = "") => {
  const t = String(texto || "").trim();
  const low = t.toLowerCase();
  if (!t) return true;
  if (tieneBloqueComplementoWeb(t)) return false;
  if (esRespuestaSecaSinDatos(t)) return true;
  const patrones = [
    "no tengo suficiente información",
    "podrías proporcionar",
    "por favor, proporciona más contexto",
    "sin datos, te puedo sugerir",
    "¿otra cosa?",
    "no hay información disponible",
    "no hay informacion disponible",
    "¿en qué zona estás interesado",
    "¿en que zona estas interesado",
    "si el cultivo fuera",
    "ejemplo parcial",
  ];
  if (patrones.some((p) => low.includes(p))) return true;
  const pideMasDatos = /necesitar[ií]a saber|podr[ií]as proporcionar|decime m[aá]s/i.test(t);
  const tieneValorPractico = /recomendaci[oó]n|conviene|vender|esperar|parcial|referencia|rango|promedio/i.test(t);
  if (pideMasDatos && !tieneValorPractico) return true;
  return false;
};

const requiereRecuperacionDatosBd = (texto = "") => {
  const t = String(texto || "").trim();
  if (!t) return false;
  if (tieneBloqueComplementoWeb(t)) return false;
  if (esRespuestaSecaSinDatos(t) || esRespuestaNoConfiable(t)) return true;
  return respuestaIndicaCarenciaDatosInternos(t);
};

const esConsultaPrecioEstricto = (pregunta = "") =>
  /\b(precio|cotizacion|cuanto|cuando\s+esta|esta\s+la|vale|cuesta|disponible|pizarra|rosario|matba|rofex)\b/.test(
    normMin(pregunta)
  );

const respuestaPrecioEscasa = ({ pregunta = "", texto = "" } = {}) => {
  if (!esConsultaPrecioEstricto(pregunta)) return false;
  const t = String(texto || "").trim();
  if (!t) return true;
  const nums = (t.match(/\d+(?:[.,]\d+)?/g) || []).length;
  const tieneMoneda = /\b(ars|usd|u\$s|\$)\b/i.test(t);
  const tieneFuente = /\b(fuente|mercado|matba|rosario|cac|bcr|magyp)\b/i.test(t);
  return nums < 2 || !tieneMoneda || !tieneFuente;
};

const cumpleMinimosRespuestaPrecio = (texto = "") => {
  const t = String(texto || "");
  const tienePrecio = /((ars|usd|u\$s)\s*\d|\$\s*\d|\d\s*(ars|usd|u\$s))/i.test(t);
  const tieneFecha = /\b\d{4}-\d{2}-\d{2}\b/.test(t) || /\b\d{2}[/-]\d{2}(?:[/-]\d{2,4})?\b/.test(t);
  const tieneFuenteOMercado = /\b(fuente|mercado|matba|rofex|rosario|cac|bcr|magyp|afa|siogranos)\b/i.test(t);
  return tienePrecio && tieneFecha && tieneFuenteOMercado;
};

const evaluarRespuestaIASinContexto = (texto = "") => {
  const t = String(texto || "");
  if (!t.trim()) return true;
  const tieneFecha =
    /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
    /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(t) ||
    /\b(hoy|ayer|fecha)\b/i.test(t);
  const tieneFuente =
    /\b(fuente|base|bd|datos|mercado|cac|magyp|dolarapi|matba|liniers|agrofy|agroads|open-meteo)\b/i.test(
      t
    );
  return !(tieneFecha && tieneFuente);
};

/** Pregunta pide yerba/tabaco pero la respuesta habla sólo de granos (típico fallback erróneo de perfil o timeout). */
const respuestaMercadoDesfasadaVersusPregunta = (pregunta = "", texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const pq = norm(String(pregunta || ""));
  const tb = norm(String(texto || ""));
  if (!pq || !tb) return false;
  if (/\byerba\b|\byerbamate\b|\byerba\s+mate\b/.test(pq)) {
    const granosFuertes = /\b(soja|ma[ií]z|trigo|girasol|cebada|sorgo)\b/;
    const mentionYerba =
      /\byerba\b|\byerbamate\b|\byerba\s+mate\b|\bmate\b.*\bprecio\b|\bprecio\b.*\bmate\b/.test(tb);
    if (granosFuertes.test(tb) && !mentionYerba) return true;
  }
  if (/\btabaco\b/.test(pq) && /\b(soja|ma[ií]z)\b/.test(tb) && !/\btabaco\b/.test(tb)) return true;
  return false;
};

const preguntaQuedoSinCoberturaClave = (pregunta = "", texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMin;
  const pq = norm(String(pregunta || ""));
  const tb = norm(String(texto || ""));
  if (!pq) return false;
  if (/variedad|spunta|kennebec/.test(pq) && !/variedad|spunta|kennebec/.test(tb)) return true;
  if (/papa|patata/.test(pq) && !/papa|patata/.test(tb)) return true;
  return false;
};

const construirFallbackDecisionUniversal = ({
  nivel = "INTERMEDIO",
  tema = "mercado",
  detalleFalta = "No tengo el dato puntual actualizado ahora.",
  contexto = "mercado estable",
  accion = "si tenés que decidir hoy, avanzá en forma parcial y revisamos cuando actualice.",
  fechaRef = null,
} = {}) => {
  const simple = [
    "📌 *Resumen*",
    "━━━━━━━━━━━━━━━━━━━━",
    detalleFalta,
    `📊 _Contexto:_ ${contexto}.`,
    `✅ _Qué haría:_ ${accion}`,
    "🔔 Te aviso cuando actualice.",
  ]
    .filter(Boolean)
    .join("\n");
  const intermedio = [
    "📌 *Sin dato puntual todavía*",
    "━━━━━━━━━━━━━━━━━━━━",
    detalleFalta,
    "",
    "👉 *Contexto rápido*",
    `- _${contexto}._`,
    "- Sin señales de salto fuerte en el corto plazo.",
    "",
    "👉 *Recomendación*",
    `- _${tema}:_ ${accion}`,
    ...(fechaRef ? ["", `🗓️ _Fecha de referencia:_ *${fechaRef}*`] : []),
  ].join("\n");
  const tecnico = [
    "📌 *Detalle técnico*",
    "━━━━━━━━━━━━━━━━━━━━",
    detalleFalta,
    `*Tema:* _${tema}_`,
    `*Contexto:* _${contexto}_`,
    `*Sugerencia:* ${accion}`,
    ...(fechaRef ? [`🗓️ *Fecha ref:* _${fechaRef}_`] : []),
  ].join("\n");
  return { simple, intermedio, tecnico };
};

const construirRespuestaFallback = (
  { usuario, precios, tipoCambio, clima } = {},
  { formatearMonedaFn, formatearFechaEsFn, ordenarItemsTipoCambioFn, formatearItemTipoCambioTextoFn } = {}
) => {
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  const formatearFechaEs = typeof formatearFechaEsFn === "function" ? formatearFechaEsFn : (v) => String(v || "");
  const ordenarItemsTipoCambio =
    typeof ordenarItemsTipoCambioFn === "function" ? ordenarItemsTipoCambioFn : (arr = []) => arr;
  const formatearItemTipoCambioTexto =
    typeof formatearItemTipoCambioTextoFn === "function" ? formatearItemTipoCambioTextoFn : (x) => String(x || "");

  const nombre = usuario?.nombre || "productor";
  const fechaPrecios = precios?.fecha ? String(precios.fecha).slice(0, 10) : "s/d";
  const fechaTc = tipoCambio?.fecha ? String(tipoCambio.fecha).slice(0, 10) : "s/d";

  const preciosTxt = (precios?.items || [])
    .slice(0, 6)
    .map((p) => `- ${p.cultivo} (${p.mercado}): ${formatearMoneda(p.precio, p.moneda)}`)
    .join("\n");

  const itemsTc = ordenarItemsTipoCambio(tipoCambio?.items || []).slice(0, 8);
  const oficialTc = itemsTc.find((x) => String(x.tipo || "").toLowerCase() === "oficial");
  const restoTc = itemsTc.filter((x) => String(x.tipo || "").toLowerCase() !== "oficial");
  const lineasTc = [];
  if (oficialTc) lineasTc.push(`- Oficial (prioridad): ${formatearItemTipoCambioTexto(oficialTc)}`);
  if (restoTc.length) {
    lineasTc.push(`- ${oficialTc ? "Otros" : "Tipos"}: ${restoTc.map((x) => formatearItemTipoCambioTexto(x)).join(" | ")}`);
  }
  const tcTxt = lineasTc.join("\n");

  const climaTxt = (clima || [])
    .slice(0, 3)
    .map((c, idx) => {
      const cuando = idx === 0 ? "Hoy" : idx === 1 ? "Mañana" : "Luego";
      return `- ${cuando} (${formatearFechaEs(c.fecha)}): ${c.descripcion || "s/d"} (${c.temp_min}°/${c.temp_max}°)`;
    })
    .join("\n");

  return [
    `No pude consultar la IA ahora, ${nombre}, pero te paso los datos disponibles.`,
    "",
    `Precios (${formatearFechaEs(fechaPrecios)}):`,
    preciosTxt || "- Sin datos de precios.",
    "",
    `Tipo de cambio (${formatearFechaEs(fechaTc)}):`,
    tcTxt || "- Sin datos de tipo de cambio.",
    "",
    "Clima próximos días:",
    climaTxt || "- Sin datos de clima para tu zona.",
    "",
    "👉 Lectura práctica:",
    "- Si tenés que decidir hoy, hacelo en forma parcial (20-30%) y revisamos con el próximo update.",
    "- Si la decisión no es urgente, esperá confirmación de precios/fuentes.",
    "",
    "Si querés, te aviso cuando entre dato actualizado.",
  ].join("\n");
};

const fallbackConsultaTimeoutConCultivo = async (
  { usuario, textoPregunta, cultivos, nivelUsuario } = {},
  { detectarCultivoConsultaFn, responderDatosCultivoFn } = {}
) => {
  const detectarCultivoConsulta =
    typeof detectarCultivoConsultaFn === "function" ? detectarCultivoConsultaFn : () => null;
  const responderDatosCultivo =
    typeof responderDatosCultivoFn === "function" ? responderDatosCultivoFn : async () => "";
  const cultivoFb = detectarCultivoConsulta(textoPregunta, cultivos);
  if (!cultivoFb) return null;
  try {
    const body = await responderDatosCultivo(cultivoFb, nivelUsuario);
    if (!String(body || "").trim()) return null;
    return `${String(body).trim()}\n\n_La capa IA tardó demasiado en este intento; datos desde la base AgroHabilis._`;
  } catch (_e) {
    return null;
  }
};

module.exports = {
  construirFallbackDecisionUniversal,
  construirRespuestaFallback,
  fallbackConsultaTimeoutConCultivo,
  sanitizarPlaceholders,
  tieneBloqueComplementoWeb,
  respuestaIndicaCarenciaDatosInternos,
  esRespuestaSecaSinDatos,
  esRespuestaNoConfiable,
  requiereRecuperacionDatosBd,
  esConsultaPrecioEstricto,
  respuestaPrecioEscasa,
  cumpleMinimosRespuestaPrecio,
  evaluarRespuestaIASinContexto,
  preguntaQuedoSinCoberturaClave,
  respuestaMercadoDesfasadaVersusPregunta,
};
