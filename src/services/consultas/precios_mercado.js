"use strict";

const responderPrecioPorMercado = async (
  { cultivo, mercadoHint = null, fechaISO = null, nivel = "INTERMEDIO" } = {},
  deps = {}
) => {
  const {
    queryFn: query,
    toISODateParamFn: toISODateParam,
    formatearMonedaFn: formatearMoneda,
    normMinFn: normMin,
    construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversal,
    adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
    lineaDatoTrazableFn: lineaDatoTrazable,
    rankRowsByPriorityFn: rankRowsByPriority,
  } = deps;
  if (!cultivo) return null;
  let fecha = fechaISO;
  if (!fecha) {
    const f = await query(
      `SELECT MAX(fecha) AS fecha FROM precios WHERE LOWER(cultivo)=LOWER($1)`,
      [cultivo]
    );
    fecha = toISODateParam(f.rows[0]?.fecha);
  }
  if (!fecha) {
    return construirFallbackDecisionUniversal({
      nivel,
      tema: cultivo,
      detalleFalta: `No tengo datos de ${cultivo} en base para esa fecha.`,
      contexto: "referencia incompleta para esa ventana",
      accion: "si hay urgencia comercial, tomá cobertura parcial y revalidamos con el próximo dato.",
    });
  }

  const params = [cultivo, fecha];
  let sql = `
    SELECT
      mercado, precio, moneda, NULL::text AS fuente, creado_en, cultivo, fecha,
      tipo_precio, calidad, presentacion, volumen_ingreso_nivel, volumen_ingreso_fuente
    FROM precios
    WHERE LOWER(cultivo)=LOWER($1)
      AND fecha = $2::date
  `;
  if (mercadoHint && mercadoHint !== "__ANY_MARKET__") {
    params.push(`%${mercadoHint}%`);
    sql += ` AND LOWER(COALESCE(mercado,'')) LIKE LOWER($3) `;
  }
  sql += ` ORDER BY mercado `;
  const r = await query(sql, params);
  if (!r.rows.length) {
    if (mercadoHint && mercadoHint !== "__ANY_MARKET__") {
      const ultMercado = await query(
        `
          SELECT mercado, precio, moneda, fecha
          FROM precios
          WHERE LOWER(cultivo) = LOWER($1)
            AND LOWER(COALESCE(mercado, '')) LIKE LOWER($2)
            AND fecha <= $3::date
          ORDER BY fecha DESC
          LIMIT 1
        `,
        [cultivo, `%${mercadoHint}%`, fecha]
      );
      const alternativasHoy = await query(
        `
          SELECT
            mercado, precio, moneda, NULL::text AS fuente, creado_en, cultivo, fecha,
            tipo_precio, calidad, presentacion, volumen_ingreso_nivel, volumen_ingreso_fuente
          FROM precios
          WHERE LOWER(cultivo) = LOWER($1)
            AND fecha = $2::date
          ORDER BY precio DESC NULLS LAST
          LIMIT 3
        `,
        [cultivo, fecha]
      );
      const ult = ultMercado.rows[0];
      const alt = rankRowsByPriority(alternativasHoy.rows || [], {
        mercadoHint: mercadoHint || null,
        cultivoSolicitado: cultivo,
      }).slice(0, 3);
      if (ult || alt.length) {
        const monedaUlt = ult?.moneda || alt[0]?.moneda || "ARS";
        const plazaNom = String(mercadoHint || "esa plaza").replace(/_/g, " ");
        const simple = [
          ult
            ? `${cultivo}: en ${plazaNom} el último dato es ${toISODateParam(ult.fecha)} → ${formatearMoneda(ult.precio, monedaUlt)}`
            : `${cultivo}: hoy no tengo cierre cargado para ${plazaNom}`,
          alt.length
            ? `Referencia hoy: ${alt
                .map((x) => `${String(x.mercado || "mercado").replace(/_/g, " ")} ${formatearMoneda(x.precio, x.moneda || monedaUlt)}`)
                .join(" | ")}`
            : "Referencia hoy: sin plazas alternativas disponibles en base.",
          `Recomendación: usá esta referencia para decidir parcial y confirmamos ${plazaNom} al cierre.`,
        ].join("\n");
        const intermedio = [
          `${cultivo.toUpperCase()} - pizarra ${plazaNom} (${fecha})`,
          ult
            ? lineaDatoTrazable({
                etiqueta: `Último dato disponible en ${plazaNom}`,
                valor: `${formatearMoneda(ult.precio, monedaUlt)} (${toISODateParam(ult.fecha)})`,
                fuente: ult.mercado || `mercado_${plazaNom}`,
                fecha: toISODateParam(ult.fecha),
                tipo: "REAL",
              })
            : `${cultivo} en ${plazaNom}: sin cierre del día.`,
          alt.length
            ? `Referencias del día: ${alt
                .map((x) => `${String(x.mercado || "mercado").replace(/_/g, " ")} ${formatearMoneda(x.precio, x.moneda || monedaUlt)}`)
                .join(" | ")}`
            : "Referencias del día: sin plazas alternativas en base.",
          `Recomendación: fijar parcial con referencia de plaza alternativa y revalidar ${plazaNom} al próximo corte.`,
        ].join("\n");
        const tecnico = [
          `${cultivo.toUpperCase()} - mercado ${plazaNom} (${fecha})`,
          ult
            ? `Último ${plazaNom}: ${formatearMoneda(ult.precio, monedaUlt)} (${toISODateParam(ult.fecha)})`
            : `Sin dato puntual para ${plazaNom} en ${fecha}.`,
          alt.length
            ? `Alternativas hoy: ${alt
                .map((x) => `${String(x.mercado || "mercado").replace(/_/g, " ")} ${formatearMoneda(x.precio, x.moneda || monedaUlt)}`)
                .join(" | ")}`
            : "Alternativas hoy: s/d",
          "Estrategia: no bloquear decisión por ausencia de una sola plaza; operar parcial con referencia y ajustar al cierre.",
        ].join("\n");
        return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico });
      }
    }
    return construirFallbackDecisionUniversal({
      nivel,
      tema: cultivo,
      detalleFalta: `No encontré ${cultivo} para ${fecha}${mercadoHint && mercadoHint !== "__ANY_MARKET__" ? ` en plaza/puerto ${mercadoHint}` : ""}.`,
      contexto: "esa plaza no mostró referencia válida en este corte",
      accion: "tomá una plaza alternativa como guía y decidí en forma parcial.",
      fechaRef: fecha,
    });
  }
  const top = rankRowsByPriority(r.rows, {
    mercadoHint: mercadoHint || null,
    cultivoSolicitado: cultivo,
  }).slice(0, 8);
  if (normMin(cultivo) === "papa") {
    const papaHortMercadoR = await query(
      `
        SELECT
          fecha, zona, variedad, calidad, tratamiento, envase, unidad,
          precio_min, precio_max, precio_promedio, tipo_precio, volumen_categoria
        FROM precios_horticolas
        WHERE producto = 'papa'
          AND fecha = $1::date
          AND ($2 = '__ANY_MARKET__' OR LOWER(zona) LIKE LOWER($3) OR LOWER(mercado) LIKE LOWER($3))
        ORDER BY zona, variedad, calidad, tratamiento, envase
      `,
      [fecha, mercadoHint || "__ANY_MARKET__", `%${mercadoHint || ""}%`]
    );
    if ((papaHortMercadoR.rows || []).length) {
      const rowsH = papaHortMercadoR.rows;
      const vals = rowsH.map((x) => Number(x.precio_promedio)).filter(Number.isFinite);
      const minH = vals.length ? Math.min(...vals) : null;
      const maxH = vals.length ? Math.max(...vals) : null;
      const promH = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const unidadRef = rowsH[0]?.unidad || "ARS/tn";
      const det = rowsH
        .slice(0, 5)
        .map(
          (x) =>
            `${x.zona || "general"} ${x.tratamiento || "s/d"} ${x.envase || "s/d"}: ${formatearMoneda(
              x.precio_promedio,
              unidadRef.includes("USD") ? "USD" : "ARS"
            )}`
        )
        .join(" | ");
      const tipoSet = [...new Set(rowsH.map((x) => String(x.tipo_precio || "").toLowerCase()).filter(Boolean))];
      const volSet = [...new Set(rowsH.map((x) => String(x.volumen_categoria || "").toLowerCase()).filter(Boolean))];
      const simple = [
        `Papa (${fecha}): ${formatearMoneda(promH, unidadRef.includes("USD") ? "USD" : "ARS")} ref.`,
        `Rango: ${formatearMoneda(minH, unidadRef.includes("USD") ? "USD" : "ARS")} - ${formatearMoneda(maxH, unidadRef.includes("USD") ? "USD" : "ARS")}`,
        `Tipo de precio: ${tipoSet.length ? tipoSet.join(", ") : "s/d"} | Volumen: ${volSet.length ? volSet.join(", ") : "s/d"}`,
      ].join("\n");
      const intermedio = [
        `PAPA - referencia hortícola (${fecha})`,
        `Detalle: ${det || "s/d"}`,
        `Promedio: ${formatearMoneda(promH, unidadRef.includes("USD") ? "USD" : "ARS")} | Rango: ${formatearMoneda(minH, unidadRef.includes("USD") ? "USD" : "ARS")} - ${formatearMoneda(maxH, unidadRef.includes("USD") ? "USD" : "ARS")}`,
        `Tipo de precio: ${tipoSet.length ? tipoSet.join(", ") : "s/d"} | Volumen ingreso: ${volSet.length ? volSet.join(", ") : "s/d"}`,
      ].join("\n");
      return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico: intermedio });
    }
    const valoresPapa = top.map((x) => Number(x.precio)).filter(Number.isFinite);
    const minPapa = valoresPapa.length ? Math.min(...valoresPapa) : null;
    const maxPapa = valoresPapa.length ? Math.max(...valoresPapa) : null;
    const promPapa = valoresPapa.length ? valoresPapa.reduce((a, b) => a + b, 0) / valoresPapa.length : null;
    const monedaPapa = top[0]?.moneda || "ARS";
    const detalleMercados = top
      .slice(0, 5)
      .map((x) => `${String(x.mercado || "MCBA").replace(/_/g, " ")} ${formatearMoneda(x.precio, x.moneda || monedaPapa)}`)
      .join(" | ");
    const tipoSet = [...new Set(top.map((x) => String(x.tipo_precio || "").toLowerCase()).filter(Boolean))];
    const volumenSet = [...new Set(top.map((x) => String(x.volumen_ingreso_nivel || "").toLowerCase()).filter(Boolean))].filter(
      (v) => v !== "s/d"
    );
    const presentacionSet = [...new Set(top.map((x) => String(x.presentacion || "").trim()).filter(Boolean))];
    const calidadSet = [...new Set(top.map((x) => String(x.calidad || "").trim()).filter(Boolean))];
    const simple = [
      `Papa (${fecha}): referencia ${formatearMoneda(promPapa, monedaPapa)} por tn`,
      `Rango: ${formatearMoneda(minPapa, monedaPapa)} - ${formatearMoneda(maxPapa, monedaPapa)}`,
      "Lectura: no usar precio único; cerrá por calidad y condición comercial del lote.",
    ].join("\n");
    const intermedio = [
      `PAPA - referencia hortícola (${fecha})`,
      lineaDatoTrazable({
        etiqueta: "Tipo de dato",
        valor: "REAL (referencia de mercado físico)",
        fuente: "tabla precios",
        fecha,
        tipo: "REAL",
      }),
      `Detalle de plazas: ${detalleMercados || "s/d"}`,
      `Rango: ${formatearMoneda(minPapa, monedaPapa)} - ${formatearMoneda(maxPapa, monedaPapa)} | Promedio: ${formatearMoneda(promPapa, monedaPapa)}`,
      `Tipo de precio detectado: ${tipoSet.length ? tipoSet.join(", ") : "s/d"}.`,
      `Volumen de ingreso detectado: ${volumenSet.length ? volumenSet.join(", ") : "s/d"}.`,
      `Presentación detectada: ${presentacionSet.length ? presentacionSet.join(", ") : "s/d"} | Calidad detectada: ${
        calidadSet.length ? calidadSet.join(", ") : "s/d"
      }.`,
      `Calidad de referencia: ${
        tipoSet.length && tipoSet.some((x) => String(x).toLowerCase() === "operacion_real")
          ? "tiene operaciones reales"
          : "referencia_debil (sin operación real confirmada)"
      }.`,
      "Importante: esta referencia puede mezclar calidades/presentaciones y no siempre representa operación cerrada homogénea.",
      "Sugerencia: usalo como termómetro y validá precio final por calidad, formato y destino.",
    ].join("\n");
    const tecnico = [
      `PAPA - referencia física (${fecha})`,
      `Plazas consideradas: ${detalleMercados || "s/d"}`,
      `Rango intrafecha: ${formatearMoneda(minPapa, monedaPapa)} - ${formatearMoneda(maxPapa, monedaPapa)} | Promedio: ${formatearMoneda(promPapa, monedaPapa)}`,
      "Nota: faltan campos normalizados de calidad/tipo_precio (oferta vs operación) para trazabilidad comercial plena.",
    ].join("\n");
    return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico });
  }
  const valores = top.map((x) => Number(x.precio)).filter(Number.isFinite);
  const min = valores.length ? Math.min(...valores) : null;
  const max = valores.length ? Math.max(...valores) : null;
  const prom = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
  const tR = await query(
    `
      SELECT
        AVG(precio)::numeric(12,2) AS hoy,
        (
          SELECT AVG(precio)::numeric(12,2)
          FROM precios
          WHERE LOWER(cultivo) = LOWER($1)
            AND fecha >= $2::date - INTERVAL '7 days'
            AND fecha < $2::date
        ) AS prev
      FROM precios
      WHERE LOWER(cultivo) = LOWER($1)
        AND fecha = $2::date
    `,
    [cultivo, fecha]
  );
  const hoy = Number(tR.rows[0]?.hoy);
  const prev = Number(tR.rows[0]?.prev);
  let tono = "estable";
  if (Number.isFinite(hoy) && Number.isFinite(prev) && prev > 0) {
    const pct = ((hoy - prev) / prev) * 100;
    if (pct >= 2) tono = "firme";
    else if (pct <= -2) tono = "flojo";
  }
  const recomendacion =
    tono === "firme"
      ? "si necesitás cerrar precio, vender una parte ahora es razonable."
      : tono === "flojo"
      ? "si no estás obligado, esperar o cubrir parcial puede ser mejor."
      : "podés avanzar parcial y esperar confirmación para el resto.";
  const simple = [
    `${cultivo}: ${formatearMoneda(prom, top[0]?.moneda || "ARS")} por tn`,
    `Rango: ${formatearMoneda(min, top[0]?.moneda || "ARS")} - ${formatearMoneda(max, top[0]?.moneda || "ARS")}`,
    `Recomendación: ${recomendacion}`,
  ].join("\n");
  const intermedio = [
    `${cultivo.toUpperCase()} - referencia de mercado (${fecha})`,
    lineaDatoTrazable({
      etiqueta: "Tipo de dato",
      valor: "REAL (referencia de mercado)",
      fuente: "tabla precios",
      fecha,
      tipo: "REAL",
    }),
    `Rango: ${formatearMoneda(min, top[0]?.moneda || "ARS")} - ${formatearMoneda(max, top[0]?.moneda || "ARS")} por tn`,
    `Promedio: ${formatearMoneda(prom, top[0]?.moneda || "ARS")} por tn`,
    `Tendencia: ${tono}`,
    `Recomendación: ${recomendacion}`,
  ].join("\n");
  const tecnico = [
    `${cultivo.toUpperCase()} - referencia de mercado (${fecha})`,
    `Promedio: ${formatearMoneda(prom, top[0]?.moneda || "ARS")} por tn | Rango: ${formatearMoneda(min, top[0]?.moneda || "ARS")} - ${formatearMoneda(max, top[0]?.moneda || "ARS")}`,
    `Tendencia: ${tono}`,
    `Spread intramercado (max-min): ${Number.isFinite(max) && Number.isFinite(min) ? (((max - min) / ((max + min) / 2 || 1)) * 100).toFixed(1) : "s/d"}%`,
    `Sugerencia estratégica: ${recomendacion}`,
  ].join("\n");
  return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico });
};

const responderDivisionPorPuerto = async (
  { usuario, fechaISO = null, nivel = "INTERMEDIO" } = {},
  deps = {}
) => {
  const {
    queryFn: query,
    toISODateParamFn: toISODateParam,
    formatearMonedaFn: formatearMoneda,
    normMinFn: normMin,
    construirFallbackDecisionUniversalFn: construirFallbackDecisionUniversal,
    adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
  } = deps;
  const cultivos = (usuario?.cultivos || []).map((c) => c.cultivo).filter(Boolean);
  if (!cultivos.length) {
    return construirFallbackDecisionUniversal({
      nivel,
      tema: "plazas/puertos",
      detalleFalta: "No tengo cultivos cargados para dividir por puerto.",
      contexto: "perfil productivo incompleto para segmentar mercados",
      accion: "usá una plaza principal de referencia hasta completar el perfil.",
    });
  }
  const normCults = cultivos.map((c) => normMin(String(c || ""))).filter(Boolean);
  const fechaRow =
    fechaISO ||
    (
      await query(
        `
          SELECT MAX(fecha) AS fecha
          FROM precios
          WHERE LOWER(TRIM(cultivo)) = ANY($1::text[])
        `,
        [normCults]
      )
    ).rows[0]?.fecha;
  const fecha = toISODateParam(fechaRow);
  if (!fecha) {
    return construirFallbackDecisionUniversal({
      nivel,
      tema: "plazas/puertos",
      detalleFalta: "Sin datos en base para dividir por puerto.",
      contexto: "sin consolidado de mercado en este momento",
      accion: "evitá fijar todo ahora; avanzá en tramos hasta tener corte completo.",
    });
  }
  const r = await query(
    `
      SELECT cultivo, mercado, AVG(precio)::numeric(12,2) AS precio, MAX(moneda) AS moneda
      FROM precios
      WHERE fecha = $1::date
        AND LOWER(cultivo) = ANY($2::text[])
      GROUP BY cultivo, mercado
      ORDER BY cultivo, mercado
    `,
    [fecha, cultivos.map((c) => normMin(c))]
  );
  if (!r.rows.length) {
    return construirFallbackDecisionUniversal({
      nivel,
      tema: cultivos.join(", "),
      detalleFalta: `Sin datos en base para ${cultivos.join(", ")} en ${fecha}.`,
      contexto: "sin publicaciones suficientes por cultivo/plaza",
      accion: "tomá cobertura parcial con referencia alternativa hasta que entre dato directo.",
      fechaRef: fecha,
    });
  }
  const bloques = [];
  const byCultivo = {};
  for (const row of r.rows) {
    const k = row.cultivo;
    if (!byCultivo[k]) byCultivo[k] = [];
    byCultivo[k].push(`- ${row.mercado}: ${formatearMoneda(row.precio, row.moneda || "ARS")}`);
  }
  for (const [c, lines] of Object.entries(byCultivo)) {
    bloques.push(`\n${c.toUpperCase()} (${fecha})\n${lines.join("\n")}`);
  }
  const intermedio = `Dividido por plaza/puerto:${bloques.join("\n")}`;
  const simple = `División por puerto lista para ${cultivos.join(", ")} (${fecha}).\nRecomendación: usá la mejor plaza para vender parcial hoy.`;
  return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico: intermedio });
};

module.exports = {
  responderPrecioPorMercado,
  responderDivisionPorPuerto,
};
