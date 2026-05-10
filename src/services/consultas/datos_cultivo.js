"use strict";

const responderDatosCultivo = async (cultivo, nivel = "INTERMEDIO", deps = {}) => {
  const {
    patronSqlCultivoFn: patronSqlCultivo,
    obtenerDisponiblePoliticaResumenUnCultivoFn: obtenerDisponiblePoliticaResumenUnCultivo,
    fechaCivilArgentinaDesdeValorFn: fechaCivilArgentinaDesdeValor,
    queryFn: query,
    construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversal,
    tieneFuentePreciosFn: tieneFuentePrecios,
    normMinFn: normMin,
    resumirValoresFn: resumirValores,
    armarTopSegmentosPapaHortFn: armarTopSegmentosPapaHortMod,
    extraerSetLowerFn: extraerSetLowerMod,
    extraerVolumenSetNoSdFn: extraerVolumenSetNoSdMod,
    extraerSetTrimFn: extraerSetTrimMod,
    formatearFechaEsFn: formatearFechaEs,
    formatearMonedaFn: formatearMoneda,
    toISODateParamFn: toISODateParam,
    construirSeriePromedioPorFechaFn: construirSeriePromedioPorFecha,
    tonoMercadoDesdeSerieFn: tonoMercadoDesdeSerie,
    calcularDispersionPctFn: calcularDispersionPct,
    armarTopMercadosPapaFn: armarTopMercadosPapaMod,
    armarSerieTxtPapaFn: armarSerieTxtPapaMod,
    calidadReferenciaPapaFn: calidadReferenciaPapaMod,
    lineaDatoTrazableFn: lineaDatoTrazable,
    adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
    rankRowsByPriorityFn: rankRowsByPriority,
    seleccionarBasePreciosPriorizadaFn: seleccionarBasePreciosPriorizadaMod,
    clasificarTipoFuentePrecioFn: clasificarTipoFuentePrecio,
    armarLineasPlazasTecnicoFn: armarLineasPlazasTecnicoMod,
    emojiCultivoResumenFn: emojiCultivoResumen,
    nombreCultivoBonitoFn: nombreCultivoBonitoMod,
    construirBloquesRespuestaCultivoGeneralFn: construirBloquesRespuestaCultivoGeneralMod,
  } = deps;
  const cultivoSqlLike = patronSqlCultivo(cultivo);
  const rowCanonica = await obtenerDisponiblePoliticaResumenUnCultivo(cultivo);
  let fechaRef = rowCanonica?.fecha ? fechaCivilArgentinaDesdeValor(rowCanonica.fecha) : null;
  if (!fechaRef) {
    const fm = await query(
      `SELECT to_char(MAX(fecha), 'YYYY-MM-DD') AS d FROM precios WHERE LOWER(cultivo) LIKE LOWER($1)`,
      [cultivoSqlLike]
    );
    fechaRef = fm.rows[0]?.d || null;
  }
  if (!fechaRef) {
    return construirFallbackDecisionUniversal({
      nivel,
      tema: cultivo,
      detalleFalta: `No tengo precio actualizado de ${cultivo} hoy para tu zona.`,
      contexto: "mercado de granos con variación moderada",
      accion: "si ya llegaste a tu objetivo de margen, vender una parte ahora es razonable y dejar el resto abierto.",
    });
  }

  const usarFp = await tieneFuentePrecios();
  const selPrecios = usarFp
    ? `SELECT fecha, mercado, precio, moneda, fuente, tipo_precio, creado_en, cultivo`
    : `SELECT fecha, mercado, precio, moneda, NULL::text AS fuente, tipo_precio, creado_en, cultivo`;

  const r = await query(
    `
      ${selPrecios}
      FROM precios
      WHERE LOWER(cultivo) LIKE LOWER($1)
        AND fecha = $2::date
      ORDER BY mercado
      LIMIT 30
    `,
    [cultivoSqlLike, fechaRef]
  );
  if (!r.rows.length) {
    return construirFallbackDecisionUniversal({
      nivel,
      tema: cultivo,
      detalleFalta: `No tengo precio actualizado de ${cultivo} hoy para tu zona.`,
      contexto: "mercado de granos con variación moderada",
      accion: "si ya llegaste a tu objetivo de margen, vender una parte ahora es razonable y dejar el resto abierto.",
    });
  }
  if (normMin(cultivo) === "papa") {
    const papaHortR = await query(
      `
        SELECT
          fecha, mercado, zona, variedad, calidad, tratamiento, envase, unidad,
          precio_min, precio_max, precio_promedio, tipo_precio, volumen_categoria, fuente
        FROM precios_horticolas
        WHERE producto = 'papa'
          AND fecha = $1::date
        ORDER BY zona, variedad, calidad, tratamiento, envase
      `,
      [fechaRef]
    );
    const analisisHortR = await query(
      `
        SELECT tendencia_precio, variacion_3d, variacion_7d, estado_mercado, presion_oferta, dispersion, outliers_detectados
        FROM analisis_mercado_horticolas
        WHERE producto = 'papa'
          AND mercado = 'MCBA'
          AND fecha = $1::date
        LIMIT 1
      `,
      [fechaRef]
    );
    if ((papaHortR.rows || []).length) {
      const rowsH = papaHortR.rows;
      const { min: minH, max: maxH, prom: promH } = resumirValores(rowsH.map((x) => x.precio_promedio));
      const unidadRef = rowsH[0]?.unidad || "ARS/tn";
      const topH = armarTopSegmentosPapaHortMod(rowsH, {
        formatearMonedaFn: formatearMoneda,
        moneda: unidadRef.includes("USD") ? "USD" : "ARS",
      });
      const tipoSetH = extraerSetLowerMod(rowsH, "tipo_precio");
      const volSetH = extraerSetLowerMod(rowsH, "volumen_categoria");
      const an = analisisHortR.rows[0] || null;
      const simpleH = [
        `🥔 *Papa* · ${formatearFechaEs(fechaRef)}`,
        "━━━━━━━━━━━━━━━━━━━━",
        `💰 _Ref:_ ${formatearMoneda(promH, unidadRef.includes("USD") ? "USD" : "ARS")}`,
        `📊 _Rango:_ ${formatearMoneda(minH, unidadRef.includes("USD") ? "USD" : "ARS")} – ${formatearMoneda(maxH, unidadRef.includes("USD") ? "USD" : "ARS")}`,
        `📌 _Mercado:_ *${an?.estado_mercado || "estable"}* · oferta: _${an?.presion_oferta || "s/d"}_`,
      ].join("\n");
      const intermedioH = [
        `🥔 *PAPA — mercado físico* (${fechaRef})`,
        "━━━━━━━━━━━━━━━━━━━━",
        `📍 *Segmentos:* ${topH || "s/d"}`,
        `Promedio referencia: ${formatearMoneda(promH, unidadRef.includes("USD") ? "USD" : "ARS")} | Rango: ${formatearMoneda(minH, unidadRef.includes("USD") ? "USD" : "ARS")} - ${formatearMoneda(maxH, unidadRef.includes("USD") ? "USD" : "ARS")}`,
        `Tipo de precio: ${tipoSetH.length ? tipoSetH.join(", ") : "s/d"} | Volumen: ${volSetH.length ? volSetH.join(", ") : "s/d"}`,
        `Tendencia: ${an?.tendencia_precio || "estable"} | Var 3d: ${an?.variacion_3d ?? "s/d"}% | Var 7d: ${an?.variacion_7d ?? "s/d"}%`,
        `Dispersión: ${an?.dispersion || "s/d"}${an?.outliers_detectados ? " | Outlier detectado: sí" : ""}`,
      ].join("\n");
      const tecnicoH = intermedioH;
      return adaptarRespuestaPorNivel(nivel, { simple: simpleH, intermedio: intermedioH, tecnico: tecnicoH });
    }
    const preciosPapaR = await query(
      `
        SELECT
          fecha, mercado, precio, moneda,
          tipo_precio, calidad, presentacion, volumen_ingreso_nivel, volumen_ingreso_fuente
        FROM precios
        WHERE LOWER(cultivo) = 'papa'
          AND fecha >= $1::date - INTERVAL '5 days'
        ORDER BY fecha DESC, mercado
      `,
      [fechaRef]
    );
    const rowsPapa = preciosPapaR.rows || [];
    const rowsFecha = rowsPapa.filter((x) => toISODateParam(x.fecha) === fechaRef);
    const { min: minHoy, max: maxHoy, prom: promHoy } = resumirValores(rowsFecha.map((x) => x.precio));
    const moneda = rowsFecha[0]?.moneda || "ARS";

    const serie = construirSeriePromedioPorFecha(rowsPapa);
    const tono = tonoMercadoDesdeSerie(serie);
    const dispersionPct = calcularDispersionPct({ min: minHoy, max: maxHoy, prom: promHoy });
    const topMercados = armarTopMercadosPapaMod(rowsFecha, {
      formatearMonedaFn: formatearMoneda,
      monedaFallback: moneda,
    });
    const tipoSet = extraerSetLowerMod(rowsFecha, "tipo_precio");
    const volumenSet = extraerVolumenSetNoSdMod(rowsFecha, "volumen_ingreso_nivel");
    const presentacionSet = extraerSetTrimMod(rowsFecha, "presentacion");
    const calidadSet = extraerSetTrimMod(rowsFecha, "calidad");
    const serieTxt = armarSerieTxtPapaMod(serie, {
      formatearFechaEsFn: formatearFechaEs,
      formatearMonedaFn: formatearMoneda,
      moneda,
    });

    const simple = [
      `🥔 *Papa* · ${formatearFechaEs(fechaRef)}`,
      "━━━━━━━━━━━━━━━━━━━━",
      `💰 _Referencia:_ ${formatearMoneda(promHoy, moneda)}/tn`,
      `📊 _Rango:_ ${formatearMoneda(minHoy, moneda)} – ${formatearMoneda(maxHoy, moneda)} (${dispersionPct === null ? "s/d" : `${dispersionPct}% dispersión`})`,
      `📌 _Señal:_ mercado *${tono}* · cerrá por _calidad de lote_, no por un solo precio.`,
    ].join("\n");
    const intermedio = [
      `🥔 *PAPA* — lectura hortícola (${fechaRef})`,
      "━━━━━━━━━━━━━━━━━━━━",
      lineaDatoTrazable({
        etiqueta: "Tipo de dato",
        valor: "REAL (referencia de mercado físico)",
        fuente: "tabla precios (MCBA/Argenpapa integrados)",
        fecha: fechaRef,
        tipo: "REAL",
      }),
      `Referencias del día: ${topMercados || "s/d"}`,
      `Rango observado: ${formatearMoneda(minHoy, moneda)} - ${formatearMoneda(maxHoy, moneda)}`,
      `Promedio de referencia: ${formatearMoneda(promHoy, moneda)} | Dispersión: ${
        dispersionPct === null ? "s/d" : `${dispersionPct}%`
      }`,
      `Evolución últimas ruedas: ${serieTxt || "s/d"}`,
      `Lectura operativa: mercado ${tono}.`,
      `Tipo de precio detectado: ${tipoSet.length ? tipoSet.join(", ") : "s/d"}.`,
      `Volumen de ingreso detectado: ${volumenSet.length ? volumenSet.join(", ") : "s/d"}.`,
      `Presentación detectada: ${presentacionSet.length ? presentacionSet.join(", ") : "s/d"} | Calidad detectada: ${
        calidadSet.length ? calidadSet.join(", ") : "s/d"
      }.`,
      `Calidad de referencia: ${calidadReferenciaPapaMod(tipoSet)}.`,
      "Importante: si figura 's/d', falta discriminación fina para cierre comercial pleno.",
      "Decisión práctica: usar rango y tendencia de 3-5 ruedas; validar precio final por calidad y condición comercial del lote.",
    ].join("\n");
    const tecnico = [
      `🥔 *PAPA — mercado físico* (${fechaRef})`,
      "━━━━━━━━━━━━━━━━━━━━",
      `📊 Rango: ${formatearMoneda(minHoy, moneda)} - ${formatearMoneda(maxHoy, moneda)} | Promedio: ${formatearMoneda(promHoy, moneda)}`,
      `Dispersión intradía: ${dispersionPct === null ? "s/d" : `${dispersionPct}%`}`,
      `Serie corta: ${serieTxt || "s/d"}`,
      "Nota de calidad de dato: referencia útil para timing, no reemplaza cierre operativo discriminado por calidad/tipo de bolsa.",
    ].join("\n");
    return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico });
  }
  let ordenadas = rankRowsByPriority(r.rows, { cultivoSolicitado: cultivo });
  if (rowCanonica) {
    const mismoRenglon = (x) =>
      String(x.mercado || "").toLowerCase() === String(rowCanonica.mercado || "").toLowerCase() &&
      Number(x.precio) === Number(rowCanonica.precio) &&
      fechaCivilArgentinaDesdeValor(x.fecha) === fechaCivilArgentinaDesdeValor(rowCanonica.fecha);
    const hit = ordenadas.find(mismoRenglon);
    if (hit) ordenadas = [hit, ...ordenadas.filter((x) => !mismoRenglon(x))];
  }
  const fecha = fechaRef;
  const {
    fisico,
    exportacion,
    mejor,
    monRef,
    baseStatsRows,
  } = seleccionarBasePreciosPriorizadaMod(ordenadas, {
    clasificarTipoFuentePrecioFn: clasificarTipoFuentePrecio,
  });
  const lineas = armarLineasPlazasTecnicoMod(baseStatsRows, {
    formatearMonedaFn: formatearMoneda,
    fechaCivilArgentinaDesdeValorFn: (v) => fechaCivilArgentinaDesdeValor(v) || fecha,
  });
  const { min, max, prom } = resumirValores(baseStatsRows.map((x) => x.precio));
  const ec = emojiCultivoResumen(cultivo);
  const nombreBon = nombreCultivoBonitoMod(cultivo);
  const { simple, intermedio, tecnico } = construirBloquesRespuestaCultivoGeneralMod({
    ec,
    nombreBon,
    fecha,
    mejor,
    monRef,
    min,
    max,
    prom,
    fisico,
    exportacion,
    lineas,
    formatearFechaEsFn: formatearFechaEs,
    formatearMonedaFn: formatearMoneda,
    fechaCivilArgentinaDesdeValorFn: fechaCivilArgentinaDesdeValor,
  });
  return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico });
};

module.exports = { responderDatosCultivo };
