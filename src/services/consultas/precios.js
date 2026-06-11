"use strict";

const formatEmojiCultivo = (cultivo = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase();
  const n = norm(cultivo);
  if (n.includes("soja")) return "🫘";
  if (n.includes("maiz")) return "🌽";
  if (n.includes("trigo")) return "🌾";
  if (n.includes("girasol")) return "🌻";
  if (n.includes("cebada")) return "🌾";
  if (n.includes("sorgo")) return "🌾";
  if (n.includes("papa")) return "🥔";
  return "📌";
};

const clasificarFilasPrecio = (rows = [], { normMinFn, normalizarFuenteFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase();
  const normFuente =
    typeof normalizarFuenteFn === "function"
      ? normalizarFuenteFn
      : (f = "") =>
          String(f || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/[^\w_]/g, "");

  return (rows || []).map((r) => {
    const mercado = norm(r.mercado);
    const fuente = normFuente(r.fuente);
    let tipoFuente = "mercado_fisico";
    let tipoEtiqueta = "Disponible";
    if (/(matba|rofex|futuro|futuros|posicion|posición)/.test(mercado) || /(matba|rofex)/.test(fuente)) {
      tipoFuente = "futuro";
      tipoEtiqueta = "Futuro";
    } else if (/(fob|fas|export)/.test(mercado)) {
      tipoFuente = "exportacion";
      tipoEtiqueta = "Exportación";
    } else if (/(insumo|fertiliz|semilla|agroquim)/.test(mercado)) {
      tipoFuente = "insumo";
      tipoEtiqueta = "Insumo";
    }
    return {
      ...r,
      _clasif: { tipoFuente, tipoEtiqueta },
    };
  });
};

const derivarTipoPriorizado = (rows = [], deps = {}) => {
  const c = clasificarFilasPrecio(rows, deps);
  const futuro = c.find((x) => x._clasif.tipoFuente === "futuro");
  if (futuro) return { tipo: "Futuro / derivados", row: futuro };
  const fisico = c.find((x) => x._clasif.tipoFuente === "mercado_fisico");
  if (fisico) return { tipo: "Disponible / mercado físico", row: fisico };
  const any = c[0] || null;
  return { tipo: any ? any._clasif.tipoEtiqueta : "s/d", row: any };
};

const formatearMoneda = (valor, moneda = "ARS") => {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return "s/d";
  const n = Number(valor);
  if (String(moneda).toUpperCase() === "USD") {
    return `USD ${n.toLocaleString("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }
  return `$ ${n.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
};

const formatearFechaEs = (v, { tz = "America/Argentina/Buenos_Aires" } = {}) => {
  if (!v) return "s/d";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const cal = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
    return cal.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: tz,
    });
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: tz,
  });
};

const cultivosParaConsultaPrecios = (
  cultivosRows = [],
  pregunta = "",
  { normMinFn, cultivosAlias = [] } = {}
) => {
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase();
  const out = [];
  const seen = new Set();
  const push = (c) => {
    const s = String(c || "").trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  for (const row of cultivosRows || []) push(row?.cultivo);
  const t = norm(pregunta);
  for (const item of cultivosAlias || []) {
    if ((item?.patrones || []).some((p) => t.includes(p))) push(item.key);
  }
  return out;
};

const resumirValores = (values = []) => {
  const vals = (values || []).map((x) => Number(x)).filter(Number.isFinite);
  const min = vals.length ? Math.min(...vals) : null;
  const max = vals.length ? Math.max(...vals) : null;
  const prom = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  return { min, max, prom, vals };
};

const construirSeriePromedioPorFecha = (rows = [], { toISODateParamFn } = {}) => {
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : () => null;
  const historicoMap = new Map();
  for (const row of rows || []) {
    const k = toISODateParam(row.fecha);
    const v = Number(row.precio);
    if (!k || !Number.isFinite(v)) continue;
    if (!historicoMap.has(k)) historicoMap.set(k, []);
    historicoMap.get(k).push(v);
  }
  return Array.from(historicoMap.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .slice(-5)
    .map(([f, vals]) => ({
      fecha: f,
      promedio: vals.reduce((acc, n) => acc + n, 0) / vals.length,
    }));
};

const tonoMercadoDesdeSerie = (serie = []) => {
  let tono = "estable";
  if ((serie || []).length >= 2) {
    const first = Number(serie[0].promedio);
    const last = Number(serie[serie.length - 1].promedio);
    if (Number.isFinite(first) && Number.isFinite(last) && first > 0) {
      const deltaPct = ((last - first) / first) * 100;
      if (deltaPct >= 3) tono = "firme";
      else if (deltaPct <= -3) tono = "pesado";
    }
  }
  return tono;
};

const calcularDispersionPct = ({ min = null, max = null, prom = null } = {}) => {
  return Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(prom) && prom > 0
    ? Number((((max - min) / prom) * 100).toFixed(1))
    : null;
};

const nombreCultivoBonito = (cultivo = "") => {
  const s = String(cultivo || "");
  return `${s.charAt(0).toUpperCase()}${s.slice(1).toLowerCase()}`;
};

const armarLineasPlazasTecnico = (
  rows = [],
  { formatearMonedaFn, fechaCivilArgentinaDesdeValorFn } = {}
) => {
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  const fechaCivilArgentinaDesdeValor =
    typeof fechaCivilArgentinaDesdeValorFn === "function"
      ? fechaCivilArgentinaDesdeValorFn
      : (v) => String(v || "");
  return (rows || [])
    .map(
      (x) =>
        `• ${x._clasif?.tipoEtiqueta || "Precio"}: ${String(x.mercado || "mercado").replace(/_/g, " ")} ${formatearMoneda(
          x.precio,
          x.moneda || "ARS"
        )} (${x.moneda || "ARS"}, ${x.fuente || "s/fuente"}, ${fechaCivilArgentinaDesdeValor(x.fecha)})`
    )
    .join("\n");
};

const armarTopMercadosPapa = (rowsFecha = [], { formatearMonedaFn, monedaFallback = "ARS" } = {}) => {
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  return (rowsFecha || [])
    .slice(0, 4)
    .map((x) => `${String(x.mercado || "MCBA").replace(/_/g, " ")} ${formatearMoneda(x.precio, x.moneda || monedaFallback)}`)
    .join(" | ");
};

const armarSerieTxtPapa = (serie = [], { formatearFechaEsFn, formatearMonedaFn, moneda = "ARS" } = {}) => {
  const formatearFechaEs = typeof formatearFechaEsFn === "function" ? formatearFechaEsFn : (v) => String(v || "");
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  return (serie || []).map((p) => `${formatearFechaEs(p.fecha)}: ${formatearMoneda(p.promedio, moneda)}`).join(" | ");
};

const extraerSetLower = (rows = [], field = "") =>
  [...new Set((rows || []).map((x) => String(x?.[field] || "").toLowerCase()).filter(Boolean))];

const extraerSetTrim = (rows = [], field = "") =>
  [...new Set((rows || []).map((x) => String(x?.[field] || "").trim()).filter(Boolean))];

const extraerVolumenSetNoSd = (rows = [], field = "volumen_ingreso_nivel") =>
  extraerSetLower(rows, field).filter((v) => v !== "s/d");

const armarTopSegmentosPapaHort = (
  rows = [],
  { formatearMonedaFn, moneda = "ARS" } = {}
) => {
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  return (rows || [])
    .slice(0, 4)
    .map(
      (x) =>
        `${String(x.zona || "general")} ${String(x.tratamiento || "s/d")} ${String(x.envase || "s/d")}: ${formatearMoneda(
          x.precio_promedio,
          moneda
        )}`
    )
    .join(" | ");
};

const tieneOperacionReal = (tipoSet = []) =>
  (tipoSet || []).some((x) => String(x).toLowerCase() === "operacion_real");

const calidadReferenciaPapa = (tipoSet = []) =>
  tieneOperacionReal(tipoSet)
    ? "tiene operaciones reales"
    : "referencia_debil (sin operación real confirmada)";

const seleccionarBasePreciosPriorizada = (
  ordenadas = [],
  { clasificarTipoFuentePrecioFn } = {}
) => {
  const clasificarTipoFuentePrecio =
    typeof clasificarTipoFuentePrecioFn === "function" ? clasificarTipoFuentePrecioFn : () => ({});
  const clasificadas = (ordenadas || []).map((x) => ({ ...x, _clasif: clasificarTipoFuentePrecio(x) }));
  const fisico = clasificadas.filter((x) => x._clasif?.tipoFuente === "mercado_fisico");
  const institucional = clasificadas.filter((x) => x._clasif?.tipoFuente === "institucional");
  const exportacion = clasificadas.filter((x) => x._clasif?.tipoFuente === "exportacion");
  const preferidas = fisico.length ? fisico : institucional.length ? institucional : exportacion;
  const mejor = preferidas[0] || clasificadas[0];
  const monRef = mejor?.moneda || "ARS";
  const ordenadasMismaMoneda = preferidas.filter(
    (x) => String(x.moneda || "ARS").toUpperCase() === String(monRef || "ARS").toUpperCase()
  );
  const baseStatsRows = ordenadasMismaMoneda.length ? ordenadasMismaMoneda : preferidas;
  return { clasificadas, fisico, institucional, exportacion, preferidas, mejor, monRef, baseStatsRows };
};

const construirBloquesRespuestaCultivoGeneral = ({
  ec = "📌",
  nombreBon = "",
  fecha = "s/d",
  mejor = null,
  monRef = "ARS",
  min = null,
  max = null,
  prom = null,
  fisico = [],
  exportacion = [],
  lineas = "",
  formatearFechaEsFn,
  formatearMonedaFn,
  fechaCivilArgentinaDesdeValorFn,
} = {}) => {
  const formatearFechaEs = typeof formatearFechaEsFn === "function" ? formatearFechaEsFn : (v) => String(v || "");
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  const fechaCivilArgentinaDesdeValor =
    typeof fechaCivilArgentinaDesdeValorFn === "function" ? fechaCivilArgentinaDesdeValorFn : (v) => String(v || "");

  const simple = [
    `${ec} *${nombreBon}* · ${formatearFechaEs(fecha)}`,
    "━━━━━━━━━━━━━━━━━━━━",
    `_Igual que tu resumen:_ *${String(mejor?.mercado || "").replace(/_/g, " ")}* ${formatearMoneda(mejor?.precio, monRef)}/tn`,
    `📊 _Rango del día:_ ${formatearMoneda(min, monRef)} – ${formatearMoneda(max, monRef)}`,
    exportacion.length && fisico.length
      ? "ℹ️ _Nota:_ FOB y disponible no son equivalentes; para decision comercial se prioriza disponible."
      : null,
    "✅ _Tip:_ si te cierra el margen, *liquidá una parte* hoy y dejá el resto abierto.",
  ]
    .filter(Boolean)
    .join("\n");

  const intermedio = [
    `${ec} *${nombreBon}* — ${formatearFechaEs(fecha)}`,
    "━━━━━━━━━━━━━━━━━━━━",
    `Tipo priorizado: ${mejor?._clasif?.tipoEtiqueta || "s/d"} | Condicion: ${mejor?._clasif?.condicionComercial || "s/d"}`,
    `Fuente: ${mejor?.fuente || "s/fuente"} | Fecha: ${fechaCivilArgentinaDesdeValor(mejor?.fecha) || fecha}`,
    `📈 _Promedio plazas:_ ${formatearMoneda(prom, monRef)}/tn`,
    `📊 _Rango:_ ${formatearMoneda(min, monRef)} – ${formatearMoneda(max, monRef)}`,
    mejor?.mercado ? `🎯 _Referencia prioritaria (resumen):_ *${String(mejor.mercado).replace(/_/g, " ")}*` : null,
    exportacion.length && fisico.length
      ? "Diferencia clave: FOB refleja exportacion puesta en barco; disponible refleja lo cobrable hoy por productor."
      : null,
    "📌 _Lectura:_ mercado estable; conviene decidir en *tramos*.",
  ]
    .filter(Boolean)
    .join("\n");

  const tecnico = [`${ec} *${nombreBon}* — ${formatearFechaEs(fecha)}`, "━━━━━━━━━━━━━━━━━━━━", "*Plazas del día:*", lineas].join(
    "\n"
  );
  return { simple, intermedio, tecnico };
};

const esConsultaInsumos = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase();
  const t = norm(texto);
  return /\binsumo(s)?\b|fertilizante(s)?|semilla(s)?|herbicida(s)?|glifosato|urea/.test(t);
};

const responderInsumos = async (
  { pregunta = "", usuario = null, nivel = "INTERMEDIO" } = {},
  deps = {}
) => {
  const {
    queryFn,
    normMinFn,
    construirFallbackDecisionUniversalFn,
    formatearMonedaFn,
    formatearFechaEsFn,
    adaptarRespuestaPorNivelFn,
  } = deps;

  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase();
  const query = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const construirFallbackDecisionUniversal =
    typeof construirFallbackDecisionUniversalFn === "function"
      ? construirFallbackDecisionUniversalFn
      : ({ detalleFalta }) => detalleFalta || "s/d";
  const formatearMoneda =
    typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  const formatearFechaEs = typeof formatearFechaEsFn === "function" ? formatearFechaEsFn : (v) => String(v || "");
  const adaptarRespuestaPorNivel =
    typeof adaptarRespuestaPorNivelFn === "function"
      ? adaptarRespuestaPorNivelFn
      : (_nivel, out) => out?.intermedio || "";

  const t = norm(pregunta);
  const fechaR = await query("SELECT MAX(fecha) AS fecha FROM precios_insumos");
  const fecha = fechaR.rows[0]?.fecha;
  if (!fecha) {
    return construirFallbackDecisionUniversal({
      nivel,
      tema: "insumos",
      detalleFalta: "No tengo insumos actualizados en base en este momento.",
      contexto: "referencias de costos incompletas en el corte actual",
      accion: "si tenés que comprar hoy, cerrá solo lo urgente y el resto lo revisamos con el próximo update.",
    });
  }

  const baseRows = await query(
    `
      SELECT categoria, producto, precio, unidad, moneda, fuente
      FROM precios_insumos
      WHERE fecha = $1
      ORDER BY categoria, producto
      LIMIT 80
    `,
    [fecha]
  );
  const rows = baseRows.rows || [];
  if (!rows.length) {
    return construirFallbackDecisionUniversal({
      nivel,
      tema: "insumos",
      detalleFalta: `No encontré insumos para la fecha ${String(fecha).slice(0, 10)}.`,
      contexto: "sin publicaciones suficientes para ese corte",
      accion: "comprá por tramos y evitá fijar todo en una sola referencia.",
      fechaRef: String(fecha).slice(0, 10),
    });
  }

  const keywords = [];
  const cultivosUsuario = (usuario?.cultivos || []).map((c) => norm(c.cultivo)).filter(Boolean);
  keywords.push(...cultivosUsuario);
  if (t.includes("maiz")) keywords.push("maiz");
  if (t.includes("soja")) keywords.push("soja");
  if (t.includes("trigo")) keywords.push("trigo");
  if (t.includes("girasol")) keywords.push("girasol");
  if (t.includes("papa")) keywords.push("papa");
  if (t.includes("fertiliz")) keywords.push("fertiliz");
  if (t.includes("semill")) keywords.push("semilla");
  if (t.includes("herbic")) keywords.push("herbic");
  if (t.includes("glifosato")) keywords.push("glifosato");
  if (t.includes("urea")) keywords.push("urea");
  if (t.includes("weedit")) keywords.push("weedit");
  if (t.includes("weedseeker")) keywords.push("weedseeker");
  if (t.includes("aplicacion")) keywords.push("aplicacion");
  if (t.includes("pulveriz")) keywords.push("pulveriz");
  if (t.includes("insectic")) keywords.push("insectic");
  if (t.includes("fungic")) keywords.push("fungic");

  let filtrados = rows;
  if (keywords.length) {
    filtrados = rows.filter((r) => {
      const bucket = `${norm(r.categoria)} ${norm(r.producto)}`;
      return keywords.some((k) => bucket.includes(k));
    });
    if (!filtrados.length) {
      const explicitKeywords = [
        "maiz", "soja", "trigo", "girasol", "papa", "fertiliz", "semill", "herbic",
        "glifosato", "urea", "weedit", "weedseeker", "aplicacion", "pulveriz",
        "insectic", "fungic"
      ];
      const esEspecifica =
        cultivosUsuario.some((c) => t.includes(c)) ||
        explicitKeywords.some((k) => t.includes(k));

      if (esEspecifica) {
        const terminosBuscados = keywords.filter((k) => t.includes(k) || cultivosUsuario.includes(k)).join(", ");
        return construirFallbackDecisionUniversal({
          nivel,
          tema: "insumos",
          detalleFalta: `sin datos en base para los insumos o productos específicos solicitados (${terminosBuscados}) en el corte del ${formatearFechaEs(fecha)}.`,
          contexto: "referencias específicas no disponibles en el corte actual de la base interna",
          accion: "te sugiero buscar una referencia externa o consultar precios de mercado alternativos.",
          fechaRef: String(fecha).slice(0, 10),
        });
      }
      filtrados = rows;
    }
  }

  const top = filtrados.slice(0, 8);
  const lines = top.map(
    (r) =>
      `- ${r.categoria}/${r.producto}: ${formatearMoneda(r.precio, r.moneda || "ARS")}${r.unidad ? ` por ${r.unidad}` : ""}`
  );
  const fuente = top[0]?.fuente ? `\nFuente: ${top[0].fuente}` : "";
  const intermedio = [
    `Insumos (${formatearFechaEs(fecha)}):`,
    ...lines,
    fuente,
  ]
    .filter(Boolean)
    .join("\n");
  const simple = [
    `Insumos (${formatearFechaEs(fecha)}): ${top.length} referencias`,
    top[0]
      ? `${top[0].categoria}/${top[0].producto}: ${formatearMoneda(top[0].precio, top[0].moneda || "ARS")}${top[0].unidad ? ` por ${top[0].unidad}` : ""}`
      : "Sin detalle",
    "Recomendación: comprá por tramos si no hay urgencia total.",
  ].join("\n");
  return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico: intermedio });
};

const etiquetaTipoCambio = (tipo = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase().trim();
  const t = norm(tipo);
  if (t === "bolsa") return "MEP";
  return String(tipo || "").toUpperCase();
};

const esConsultaDolar = (texto = "") => /dolar|dólar|blue|mep|ccl|oficial|tipo de cambio/i.test(String(texto));

const tipoCambioEsFresco = async ({ queryFn, toISODateParamFn, fechaISOArgentinaFn } = {}) => {
  const query = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : (x) => x;
  const fechaISOArgentina = typeof fechaISOArgentinaFn === "function" ? fechaISOArgentinaFn : () => null;
  const r = await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio");
  const f = toISODateParam(r.rows[0]?.fecha);
  return Boolean(f && f === fechaISOArgentina());
};

const responderDolarActual = async ({
  queryFn,
  toISODateParamFn,
  tieneCompraTipoCambioFn,
  tieneFuenteTipoCambioFn,
  ordenarItemsTipoCambioFn,
  formatearItemTipoCambioTextoFn,
  etiquetaTipoCambioFn,
} = {}) => {
  const query = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : (x) => x;
  const tieneCompraTipoCambio = typeof tieneCompraTipoCambioFn === "function" ? tieneCompraTipoCambioFn : async () => false;
  const tieneFuenteTipoCambio = typeof tieneFuenteTipoCambioFn === "function" ? tieneFuenteTipoCambioFn : async () => false;
  const ordenarItemsTipoCambio = typeof ordenarItemsTipoCambioFn === "function" ? ordenarItemsTipoCambioFn : (x) => x;
  const formatearItemTipoCambioTexto =
    typeof formatearItemTipoCambioTextoFn === "function" ? formatearItemTipoCambioTextoFn : (x) => String(x || "");
  const etiquetaTipoCambioImpl = typeof etiquetaTipoCambioFn === "function" ? etiquetaTipoCambioFn : (x) => String(x || "");

  const fechaR = await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio");
  const fecha = toISODateParam(fechaR.rows[0]?.fecha);
  if (!fecha) return "No tengo cotización de dólar disponible ahora.";
  const usarCompra = await tieneCompraTipoCambio();
  const usarFuente = await tieneFuenteTipoCambio();
  const r = await query(
    `
      SELECT
        tipo,
        valor,
        ${usarCompra ? "compra" : "NULL::numeric AS compra"},
        fecha,
        ${usarFuente ? "fuente" : "NULL::text AS fuente"}
      FROM tipo_cambio
      WHERE fecha = $1::date
    `,
    [fecha]
  );
  if (!r.rows.length) return "No tengo cotización de dólar disponible ahora.";
  const items = ordenarItemsTipoCambio(r.rows);
  const oficial = items.find((x) => String(x.tipo || "").toLowerCase() === "oficial");
  const resto = items.filter((x) => String(x.tipo || "").toLowerCase() !== "oficial");
  const fuente = oficial?.fuente || resto[0]?.fuente || "ref";
  const bloques = ["💵 Cotización del dólar", "---------------------", `Fecha: ${fecha}`];
  if (oficial) {
    bloques.push(`- Dólar oficial (prioridad): ${formatearItemTipoCambioTexto(oficial)} [${fuente}]`);
  }
  if (resto.length) {
    bloques.push(`- ${oficial ? "Otros tipos de cambio" : "Tipos de cambio"}:`);
    bloques.push(...resto.map((x) => `  · ${formatearItemTipoCambioTexto({ ...x, tipo: etiquetaTipoCambioImpl(x.tipo) })}`));
  }
  return bloques.join("\n");
};

module.exports = {
  armarLineasPlazasTecnico,
  armarSerieTxtPapa,
  armarTopSegmentosPapaHort,
  armarTopMercadosPapa,
  calcularDispersionPct,
  construirSeriePromedioPorFecha,
  cultivosParaConsultaPrecios,
  calidadReferenciaPapa,
  extraerSetLower,
  extraerSetTrim,
  extraerVolumenSetNoSd,
  formatearFechaEs,
  formatearMoneda,
  formatEmojiCultivo,
  tieneOperacionReal,
  nombreCultivoBonito,
  construirBloquesRespuestaCultivoGeneral,
  esConsultaInsumos,
  esConsultaDolar,
  etiquetaTipoCambio,
  responderDolarActual,
  responderInsumos,
  seleccionarBasePreciosPriorizada,
  tipoCambioEsFresco,
  resumirValores,
  tonoMercadoDesdeSerie,
  clasificarFilasPrecio,
  derivarTipoPriorizado,
};
