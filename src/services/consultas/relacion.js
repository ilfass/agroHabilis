"use strict";

const consultaPideDisponibleYMatba = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase();
  const t = norm(texto);
  const pideDisponible = /(disponible|rosario|pizarra|fisico|físico)/.test(t);
  const pideMatba = /(matba|rofex|futuro|futuros)/.test(t);
  return pideDisponible && pideMatba;
};

const tokenPosicionPorMes = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase();
  const t = norm(texto);
  if (/\bmayo\b|\bmay\b/.test(t)) return "%MAY%";
  if (/\bjunio\b|\bjun\b/.test(t)) return "%JUN%";
  if (/\bjulio\b|\bjul\b/.test(t)) return "%JUL%";
  if (/\bagosto\b|\bago\b|\baug\b/.test(t)) return "%AUG%";
  return "";
};

const obtenerFuturoMatbaReferencia = async ({
  cultivo = "",
  posicionLike = "",
  queryFn,
  normMinFn,
  toISODateParamFn,
} = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase();
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : (x) => x;
  const cultivoNorm = norm(cultivo);
  if (!cultivoNorm || typeof queryFn !== "function") return null;
  const r = await queryFn(
    `
      SELECT posicion, precio_usd, fecha
      FROM futuros_posiciones
      WHERE LOWER(cultivo) = LOWER($1)
        AND precio_usd IS NOT NULL
        AND ($2::text = '' OR UPPER(COALESCE(posicion, '')) LIKE $2)
      ORDER BY fecha DESC
      LIMIT 1
    `,
    [cultivoNorm, String(posicionLike || "").toUpperCase()]
  );
  const row = r.rows?.[0];
  if (!row) return null;
  return {
    posicion: row.posicion || null,
    precioUsd: Number(row.precio_usd),
    fecha: toISODateParam(row.fecha),
  };
};

const normMinDefault = (texto = "") =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const ACTIVOS_RELACION = [
  { key: "maiz", tipo: "grano", re: /ma[ií]z/ },
  { key: "soja", tipo: "grano", re: /\bsoja\b/ },
  { key: "trigo", tipo: "grano", re: /\btrigo\b/ },
  { key: "girasol", tipo: "grano", re: /\bgirasol\b/ },
  { key: "novillo", tipo: "hacienda", re: /\bnovill[oa]s?\b/, categoriaLike: "%novill%" },
  { key: "ternero", tipo: "hacienda", re: /\bterner[oa]s?\b|\binvernada\b/, categoriaLike: "%terner%" },
  { key: "vaca", tipo: "hacienda", re: /\bvacas?\b/, categoriaLike: "%vaca%" },
  { key: "vaquillona", tipo: "hacienda", re: /\bvaquillonas?\b/, categoriaLike: "%vaquillon%" },
];

const detectarActivosRelacion = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMinDefault;
  const t = norm(texto);
  const hits = [];
  for (const a of ACTIVOS_RELACION) {
    const m = t.match(a.re);
    if (m && typeof m.index === "number") hits.push({ ...a, idx: m.index });
  }
  return hits.sort((x, y) => x.idx - y.idx);
};

const esConsultaRelacionIntercambio = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMinDefault;
  const t = norm(texto);
  const activos = detectarActivosRelacion(texto, { normMinFn });
  const keywords = /(relacion|relación|ratio|equivalencia|intercambio|vs|versus|\b\/\b)/.test(t);
  return (keywords && activos.length >= 2) || activos.length >= 2;
};

const obtenerPrecioGranoArsKg = async (cultivo = "", deps = {}) => {
  const {
    obtenerDisponiblePoliticaResumenUnCultivoFn,
    obtenerTcImplicitoDiaFn,
    toISODateParamFn,
  } = deps;
  if (typeof obtenerDisponiblePoliticaResumenUnCultivoFn !== "function") return null;
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : (x) => x;
  const row = await obtenerDisponiblePoliticaResumenUnCultivoFn(cultivo);
  if (!row || !Number.isFinite(Number(row.precio))) return null;
  const mon = String(row.moneda || "ARS").toUpperCase();
  let arsTn = null;
  if (mon === "ARS") {
    arsTn = Number(row.precio);
  } else if (mon === "USD" && typeof obtenerTcImplicitoDiaFn === "function") {
    const tc = await obtenerTcImplicitoDiaFn(toISODateParam(row.fecha));
    if (tc && Number.isFinite(Number(tc.valor)) && Number(tc.valor) > 0) arsTn = Number(row.precio) * Number(tc.valor);
  }
  if (!Number.isFinite(arsTn) || arsTn <= 0) return null;
  return {
    key: cultivo,
    tipo: "grano",
    precioArsKg: arsTn / 1000,
    precioOriginal: Number(row.precio),
    unidadOriginal: "tn",
    monedaOriginal: mon,
    mercado: row.mercado || "referencia",
    fecha: toISODateParam(row.fecha),
    fuente: row.fuente || "disponible_politica",
  };
};

const obtenerPrecioHaciendaArsKg = async ({ key, categoriaLike }, deps = {}) => {
  const { queryFn, toISODateParamFn } = deps;
  const query = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : (x) => x;
  const fechaR = await query("SELECT MAX(fecha) AS fecha FROM precios_hacienda");
  const fecha = toISODateParam(fechaR.rows[0]?.fecha);
  if (!fecha) return null;
  const r = await query(
    `
      SELECT categoria, AVG(precio_promedio)::numeric(12,2) AS precio, MAX(unidad) AS unidad
      FROM precios_hacienda
      WHERE fecha = $1::date
        AND LOWER(categoria) LIKE $2
      GROUP BY categoria
      ORDER BY categoria
      LIMIT 1
    `,
    [fecha, categoriaLike]
  );
  const row = r.rows[0];
  if (!row || !Number.isFinite(Number(row.precio))) return null;
  return {
    key,
    tipo: "hacienda",
    precioArsKg: Number(row.precio),
    precioOriginal: Number(row.precio),
    unidadOriginal: String(row.unidad || "kg"),
    monedaOriginal: "ARS",
    mercado: "hacienda",
    fecha,
    fuente: "precios_hacienda",
    categoria: row.categoria,
  };
};

const obtenerPrecioActivoRelacion = async (activo, deps = {}) => {
  if (!activo) return null;
  if (activo.tipo === "grano") return obtenerPrecioGranoArsKg(activo.key, deps);
  if (activo.tipo === "hacienda")
    return obtenerPrecioHaciendaArsKg({ key: activo.key, categoriaLike: activo.categoriaLike }, deps);
  return null;
};

const responderRelacionIntercambio = async (
  { texto = "", nivel = "INTERMEDIO", modoOrientativo = false } = {},
  deps = {}
) => {
  const {
    normMinFn,
    consultaPideDisponibleYMatbaFn,
    tokenPosicionPorMesFn,
    obtenerFuturoMatbaReferenciaFn,
    obtenerPrecioActivoRelacionFn,
    formatearMonedaFn,
    adaptarRespuestaPorNivelFn,
  } = deps;

  const formatearMoneda =
    typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  const adaptarRespuestaPorNivel =
    typeof adaptarRespuestaPorNivelFn === "function"
      ? adaptarRespuestaPorNivelFn
      : (_nivel, out) => out?.intermedio || "";

  const activos = detectarActivosRelacion(texto, { normMinFn });
  if (activos.length < 2) return null;
  const par = [activos[0], activos.find((a) => a.key !== activos[0].key)].filter(Boolean).slice(0, 2);
  if (par.length < 2) return null;
  const [a, b] = par;
  const pideComparabilidad =
    typeof consultaPideDisponibleYMatbaFn === "function" ? consultaPideDisponibleYMatbaFn(texto) : false;
  if (pideComparabilidad && typeof obtenerFuturoMatbaReferenciaFn === "function") {
    const posicionLike =
      typeof tokenPosicionPorMesFn === "function" ? tokenPosicionPorMesFn(texto) : "";
    const [fa, fb] = await Promise.all([
      obtenerFuturoMatbaReferenciaFn({ cultivo: a.key, posicionLike }),
      obtenerFuturoMatbaReferenciaFn({ cultivo: b.key, posicionLike }),
    ]);
    if (!fa || !fb) {
      return [
        "__NO_MEZCLA_CIERRES__",
        "📌 *Sin dato MATBA validado al momento para comparación homogénea*",
        "━━━━━━━━━━━━━━━━━━━━",
        `- Disponible: puedo usar referencia Rosario para ${String(a.key).toUpperCase()} y ${String(b.key).toUpperCase()}.`,
        `- MATBA solicitado: ${!fa ? String(a.key).toUpperCase() : ""}${!fa && !fb ? " y " : ""}${
          !fb ? String(b.key).toUpperCase() : ""
        } sin posición comparable validada ahora.`,
        "",
        "👉 Para no mezclar cierres/fuentes, no cierro el ratio combinado en este corte.",
        "Si querés, te paso ahora el ratio con disponible homogéneo y cuando entre MATBA comparable te aviso.",
      ].join("\n");
    }
  }
  const obtenerPrecio = typeof obtenerPrecioActivoRelacionFn === "function" ? obtenerPrecioActivoRelacionFn : () => null;
  const [pa, pb] = await Promise.all([obtenerPrecio(a), obtenerPrecio(b)]);
  if (!pa || !pb || !Number.isFinite(pa.precioArsKg) || !Number.isFinite(pb.precioArsKg) || pa.precioArsKg <= 0 || pb.precioArsKg <= 0) {
    return [
      "📌 *No tengo patas completas para cerrar la relación hoy*",
      "━━━━━━━━━━━━━━━━━━━━",
      `- ${String(a.key).toUpperCase()}: ${pa ? "con referencia disponible" : "sin dato puntual en base"}.`,
      `- ${String(b.key).toUpperCase()}: ${pb ? "con referencia disponible" : "sin dato puntual en base"}.`,
      "",
      "👉 Puedo darte una lectura orientativa con fuentes externas y supuestos explícitos.",
      "Si querés, respondeme *si* y lo hago ahora.",
      "",
      "_sin dato puntual en base para cálculo comparable completo_",
    ].join("\n");
  }

  const aSobreB = pa.precioArsKg / pb.precioArsKg;
  const bSobreA = pb.precioArsKg / pa.precioArsKg;
  const fechaRef = [pa.fecha, pb.fecha].filter(Boolean).sort().reverse()[0] || "s/d";
  const esMaizNovillo = (a.key === "maiz" && b.key === "novillo") || (a.key === "novillo" && b.key === "maiz");
  const kgMaizPorKgNov = esMaizNovillo ? (a.key === "novillo" ? aSobreB : bSobreA) : null;
  const kgNovPorTnMaiz = Number.isFinite(kgMaizPorKgNov) && kgMaizPorKgNov > 0 ? 1000 / kgMaizPorKgNov : null;

  const lineas = [
    `📊 *Relación ${String(a.key).toUpperCase()}/${String(b.key).toUpperCase()}* (${fechaRef})`,
    "━━━━━━━━━━━━━━━━━━━━",
    `- ${String(a.key).toUpperCase()}: ${formatearMoneda(pa.precioOriginal, pa.monedaOriginal)}${pa.unidadOriginal ? `/${pa.unidadOriginal}` : ""} (${pa.mercado}, ${pa.fecha || "s/d"})`,
    `- ${String(b.key).toUpperCase()}: ${formatearMoneda(pb.precioOriginal, pb.monedaOriginal)}${pb.unidadOriginal ? `/${pb.unidadOriginal}` : ""} (${pb.mercado}, ${pb.fecha || "s/d"})`,
    "",
    `- Equivalencia 1 ${a.key}: ${aSobreB.toFixed(2)} ${b.key}`,
    `- Equivalencia 1 ${b.key}: ${bSobreA.toFixed(2)} ${a.key}`,
  ];
  let lectura = "👉 Lectura: relación en zona neutral; conviene operar escalonado y revisar costos.";
  let accion =
    "👉 Acción sugerida: para encierre, definí una parte del maíz y mantené flexibilidad en el resto según evolución semanal.";
  let riesgo = "⚠️ Riesgo: descalce temporal entre plazas/fechas puede distorsionar la señal.";
  if (Number.isFinite(kgMaizPorKgNov) && Number.isFinite(kgNovPorTnMaiz)) {
    lineas.push(`- 1 kg de novillo compra ~${kgMaizPorKgNov.toFixed(1)} kg de maíz.`);
    lineas.push(`- Para 1 tn de maíz necesitás ~${kgNovPorTnMaiz.toFixed(1)} kg de novillo.`);
    lineas.push("");
    if (kgMaizPorKgNov >= 14) {
      lectura = "👉 Lectura: relación alta; suele favorecer al feedlot porque el novillo compra más maíz.";
      accion = "👉 Acción sugerida: si el resto de costos acompaña, podés sostener/estirar encierre en forma parcial.";
    } else if (kgMaizPorKgNov <= 10) {
      lectura = "👉 Lectura: relación baja; maíz relativamente caro frente al ganado.";
      accion =
        "👉 Acción sugerida: priorizá eficiencia de conversión y cobertura parcial de maíz antes de ampliar encierre.";
    } else {
      lectura = "👉 Lectura: relación intermedia; señal mixta para encierre.";
      accion = "👉 Acción sugerida: operar por tramos y revalidar con próximo corte de precios.";
    }
    lineas.push(lectura);
  } else if (modoOrientativo) {
    lineas.push("");
    lineas.push("👉 Lectura orientativa: tomá la equivalencia como referencia y validá plaza/fecha antes de decidir.");
  }
  lineas.push(accion);
  lineas.push(riesgo);

  const simple = [
    lineas[0],
    lineas[2],
    lineas[3],
    `- Eq. rápida: 1 ${a.key} = ${aSobreB.toFixed(2)} ${b.key} | 1 ${b.key} = ${bSobreA.toFixed(2)} ${a.key}`,
    Number.isFinite(kgMaizPorKgNov) && Number.isFinite(kgNovPorTnMaiz)
      ? `- Regla práctica: 1 kg novillo ≈ ${kgMaizPorKgNov.toFixed(1)} kg maíz; 1 tn maíz ≈ ${kgNovPorTnMaiz.toFixed(1)} kg novillo.`
      : null,
    lectura,
    accion,
  ]
    .filter(Boolean)
    .join("\n");

  return adaptarRespuestaPorNivel(nivel, {
    simple,
    intermedio: lineas.join("\n"),
    tecnico: lineas.join("\n"),
  });
};

const humanizarRelacionConIA = async ({ pregunta = "", textoBase = "" } = {}, deps = {}) => {
  const { generarConPromptLibreFn, sanitizarPlaceholdersFn } = deps;
  const base = String(textoBase || "").trim();
  if (!base) return base;
  if (!process.env.GEMINI_API_KEY?.trim()) return base;
  if (typeof generarConPromptLibreFn !== "function") return base;
  try {
    const ia = await generarConPromptLibreFn({
      system:
        "Sos asesor agroeconómico argentino. Humanizá el texto sin cambiar números, unidades, fechas ni fuentes. " +
        "Estructura obligatoria: Datos -> Equivalencia -> Interpretación -> Acción -> Riesgo. " +
        "Máximo 10 líneas, tono claro y práctico para productor.",
      user: `Consulta: ${String(pregunta || "").slice(0, 200)}\n\nBase calculada:\n${base}`,
    });
    const sanitizar =
      typeof sanitizarPlaceholdersFn === "function" ? sanitizarPlaceholdersFn : (x) => String(x || "");
    const txt = sanitizar(String(ia?.texto || "").trim());
    if (!txt) return base;
    return txt;
  } catch (_e) {
    return base;
  }
};

module.exports = {
  ACTIVOS_RELACION,
  consultaPideDisponibleYMatba,
  detectarActivosRelacion,
  esConsultaRelacionIntercambio,
  humanizarRelacionConIA,
  obtenerFuturoMatbaReferencia,
  obtenerPrecioActivoRelacion,
  obtenerPrecioGranoArsKg,
  obtenerPrecioHaciendaArsKg,
  responderRelacionIntercambio,
  tokenPosicionPorMes,
};
