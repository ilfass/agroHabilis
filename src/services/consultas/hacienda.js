"use strict";

const MARCO_REFERENCIA_HACIENDA = {
  fuente_principal:
    "https://www.mercadoagroganadero.com.ar/dll/preguntas-frecuentes.html",
  indicadores: {
    inmag: {
      descripcion: "Indice Novillo Mercado Agroganadero",
      metodo: "promedio_ponderado_por_peso",
      formula: "SUM(peso_lote * precio_lote) / SUM(peso_lote)",
      reglas_inclusion: [
        "novillos mestizos con peso superior al umbral vigente",
        "novillos overo negro (cualquier peso)",
        "novillos cruza cebu (cualquier peso)",
        "novillos cruza europea (cualquier peso)",
        "novillos conserva (cualquier peso)",
      ],
      cambio_metodologico: {
        referencia: "ONCCA 5701/2005",
        desde_aprox: "2005-12-09",
        nota: "para mestizos se usa umbral de peso superior a 430 kg",
      },
    },
    inmag_sugerido_arrendamientos_rofex: {
      descripcion:
        "serie sugerida para continuidad historica del esquema previo",
      objetivo:
        "evitar quiebres al comparar periodos con distinta metodologia",
    },
    igmag: {
      descripcion: "Indice General Mercado Agroganadero",
      metodo: "promedio general diario de operaciones en pie",
    },
  },
  pautas_ia: [
    "aclarar que INMAG es ponderado por peso y no promedio simple",
    "mencionar fecha y metodologia utilizada",
    "si faltan datos o hay mezcla de series, advertir explicitamente",
  ],
};

const normMinDefault = (texto = "") =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const esConsultaHaciendaVenta = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMinDefault;
  const t = norm(texto);
  const mencionaHacienda = /(hacienda|ganad|terner|invernada|novill|vaca|vaquillona|cria|cría)/.test(t);
  const pideDecision =
    /(conviene|vender|esperar|firme|flojo|precio|cuanto|cuánto|subio|subió|bajo|bajó|planchad|tendencia|vienen)/.test(
      t
    );
  return mencionaHacienda && pideDecision;
};

const detectarCategoriaHacienda = (texto = "", { normMinFn } = {}) => {
  const norm = typeof normMinFn === "function" ? normMinFn : normMinDefault;
  const t = norm(texto);
  if (/terner|invernada|cria|cría/.test(t)) return "ternero";
  if (/novill/.test(t)) return "novillo";
  if (/vaquillon/.test(t)) return "vaquillona";
  if (/vaca/.test(t)) return "vaca";
  return null;
};

const responderHaciendaSimple = async (
  { texto = "", nivel = "INTERMEDIO" } = {},
  {
    detectarCategoriaHaciendaFn,
    queryFn,
    toISODateParamFn,
    construirFallbackDecisionUniversalFn,
    formatearMonedaFn,
    adaptarRespuestaPorNivelFn,
    lineaDatoTrazableFn,
  } = {}
) => {
  const detectarCategoriaHaciendaSafe =
    typeof detectarCategoriaHaciendaFn === "function" ? detectarCategoriaHaciendaFn : () => null;
  const query = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : () => null;
  const construirFallbackDecisionUniversal =
    typeof construirFallbackDecisionUniversalFn === "function"
      ? construirFallbackDecisionUniversalFn
      : ({ detalleFalta }) => detalleFalta || "s/d";
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  const adaptarRespuestaPorNivel =
    typeof adaptarRespuestaPorNivelFn === "function" ? adaptarRespuestaPorNivelFn : (_nivel, out) => out?.intermedio || "";
  const lineaDatoTrazable = typeof lineaDatoTrazableFn === "function" ? lineaDatoTrazableFn : () => "";

  const categoriaHint = detectarCategoriaHaciendaSafe(texto);
  const fechaR = await query("SELECT MAX(fecha) AS fecha FROM precios_hacienda");
  const fecha = toISODateParam(fechaR.rows[0]?.fecha);
  if (!fecha) {
    return construirFallbackDecisionUniversal({
      nivel,
      tema: categoriaHint || "hacienda",
      detalleFalta: categoriaHint
        ? `No tengo precio actualizado de ${categoriaHint} en hacienda ahora.`
        : "No tengo precios de hacienda cargados ahora.",
      contexto: "mercado ganadero sin actualización consolidada en este corte",
      accion: "si tenés hacienda lista, podés avanzar en venta parcial y revisamos cuando entre el próximo dato.",
    });
  }
  let rows;
  if (categoriaHint) {
    const r = await query(
      `
        SELECT categoria, precio_promedio, unidad, fecha
        FROM precios_hacienda
        WHERE fecha = $1::date
          AND LOWER(categoria) LIKE $2
        ORDER BY categoria
        LIMIT 5
      `,
      [fecha, `%${categoriaHint}%`]
    );
    rows = r.rows;
  } else {
    const r = await query(
      `
        SELECT categoria, precio_promedio, unidad, fecha
        FROM precios_hacienda
        WHERE fecha = $1::date
        ORDER BY categoria
        LIMIT 5
      `,
      [fecha]
    );
    rows = r.rows;
  }
  if (!rows.length) {
    const refHoyRows = await query(
      `
        SELECT categoria, precio_promedio, unidad
        FROM precios_hacienda
        WHERE fecha = $1::date
        ORDER BY categoria
        LIMIT 20
      `,
      [fecha]
    );
    const refVals = refHoyRows.rows.map((x) => Number(x.precio_promedio)).filter(Number.isFinite);
    const refMin = refVals.length ? Math.min(...refVals) : null;
    const refMax = refVals.length ? Math.max(...refVals) : null;
    const refProm = refVals.length ? refVals.reduce((a, b) => a + b, 0) / refVals.length : null;
    const refUnidad = refHoyRows.rows[0]?.unidad || "kg";
    const tendenciaR = await query(
      `
        SELECT
          AVG(h.precio_promedio)::numeric(10,2) AS hoy,
          (
            SELECT AVG(h2.precio_promedio)::numeric(10,2)
            FROM precios_hacienda h2
            WHERE h2.fecha >= $1::date - INTERVAL '7 days'
              AND h2.fecha < $1::date
          ) AS prev
        FROM precios_hacienda h
        WHERE h.fecha = $1::date
      `,
      [fecha]
    );
    const hoy = Number(tendenciaR.rows[0]?.hoy);
    const prev = Number(tendenciaR.rows[0]?.prev);
    let tono = "estable";
    if (Number.isFinite(hoy) && Number.isFinite(prev) && prev > 0) {
      const pct = ((hoy - prev) / prev) * 100;
      if (pct >= 2) tono = "firme";
      else if (pct <= -2) tono = "flojo";
    }
    const tieneCategoria = Boolean(categoriaHint);
    const intermedio = [
      tieneCategoria
        ? `No tengo precio actualizado de ${categoriaHint} hoy para tu zona.`
        : "No tengo precio actualizado de hacienda hoy para tu zona.",
      ...(refVals.length
        ? [
            "",
            "Referencia de mercado disponible:",
            `Rango: ${formatearMoneda(refMin, "ARS")} - ${formatearMoneda(refMax, "ARS")}/${refUnidad}`,
            `Promedio: ${formatearMoneda(refProm, "ARS")}/${refUnidad}`,
          ]
        : []),
      "",
      "👉 Pero te doy contexto rápido:",
      `- El mercado viene ${tono}.`,
      "- Sin señales de salto fuerte en el corto plazo.",
      "",
      "👉 Lectura práctica:",
      "- Si ya está listo para venta, vender ahora es razonable.",
      "- Esperar puede sumar algo, pero hoy no hay señal fuerte de suba.",
      "",
      "Si querés, cuando tenga precio actualizado te aviso.",
      "",
      `Fecha de referencia del mercado: ${fecha}`,
    ].join("\n");
    const simple = [
      tieneCategoria
        ? `No tengo precio de ${categoriaHint} hoy para tu zona.`
        : "No tengo precio de hacienda hoy para tu zona.",
      refVals.length
        ? `Referencia mercado: ${formatearMoneda(refProm, "ARS")}/${refUnidad} (rango ${formatearMoneda(refMin, "ARS")} - ${formatearMoneda(refMax, "ARS")})`
        : "Sin referencia numérica hoy.",
      `Señal: ${tono}. Recomendación: vender parcial si está listo.`,
    ].join("\n");
    const tecnico = intermedio;
    return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico });
  }
  const objetivo = rows[0];
  const prevR = await query(
    `
      SELECT AVG(precio_promedio)::numeric(10,2) AS p
      FROM precios_hacienda
      WHERE LOWER(categoria) = LOWER($1)
        AND fecha >= $2::date - INTERVAL '7 days'
        AND fecha < $2::date
    `,
    [objetivo.categoria, fecha]
  );
  const pHoy = Number(objetivo.precio_promedio);
  const pPrev = Number(prevR.rows[0]?.p);
  let tono = "estable";
  if (Number.isFinite(pHoy) && Number.isFinite(pPrev) && pPrev > 0) {
    const pct = ((pHoy - pPrev) / pPrev) * 100;
    if (pct >= 2) tono = "firme";
    else if (pct <= -2) tono = "flojo";
  }
  const unidad = objetivo.unidad || "kg";
  const preciosMatch = rows.map((x) => Number(x.precio_promedio)).filter(Number.isFinite);
  const min = preciosMatch.length ? Math.min(...preciosMatch) : null;
  const max = preciosMatch.length ? Math.max(...preciosMatch) : null;
  const promedio = preciosMatch.length ? preciosMatch.reduce((a, b) => a + b, 0) / preciosMatch.length : pHoy;
  const categorias = [...new Set(rows.map((x) => x.categoria).filter(Boolean))].slice(0, 3);
  const recomendacion =
    tono === "firme"
      ? "si ya los tenés listos, vender ahora una parte es razonable."
      : tono === "flojo"
      ? "si podés esperar, no vender todo ahora puede ser mejor."
      : "podés vender parcial ahora y revisar el resto con próximo dato.";
  const simple = [
    `${categorias[0] || objetivo.categoria}: ${formatearMoneda(promedio, "ARS")}/${unidad}`,
    `Rango: ${formatearMoneda(min, "ARS")} - ${formatearMoneda(max, "ARS")}/${unidad}`,
    `Recomendación: ${recomendacion}`,
  ].join("\n");
  const intermedio = [
    `Referencia de mercado hacienda (${fecha})`,
    lineaDatoTrazable({
      etiqueta: "Tipo de dato",
      valor: "REAL (referencia de mercado)",
      fuente: "tabla precios_hacienda",
      fecha,
      tipo: "REAL",
    }),
    `Categoría: ${categorias.join(" / ") || objetivo.categoria}`,
    `Rango: ${formatearMoneda(min, "ARS")} - ${formatearMoneda(max, "ARS")}/${unidad}`,
    `Promedio: ${formatearMoneda(promedio, "ARS")}/${unidad}`,
    `Tendencia: ${tono}`,
    `Recomendación: ${recomendacion}`,
  ].join("\n");
  const tecnico = [
    `Hacienda (${fecha})`,
    `Categorías: ${categorias.join(" / ") || objetivo.categoria}`,
    `Promedio: ${formatearMoneda(promedio, "ARS")}/${unidad} | Rango: ${formatearMoneda(min, "ARS")} - ${formatearMoneda(max, "ARS")}/${unidad}`,
    `Tendencia: ${tono}`,
    `Sugerencia estratégica: ${recomendacion}`,
  ].join("\n");
  return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico });
};

module.exports = {
  MARCO_REFERENCIA_HACIENDA,
  responderHaciendaSimple,
  esConsultaHaciendaVenta,
  detectarCategoriaHacienda,
};
