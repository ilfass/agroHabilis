const { query } = require("../config/database");
const { generarConPromptLibre } = require("./gemini");
const { calcularCostoPorHa } = require("./calculadora_costos");

const RETENCIONES = {
  soja: 0.33,
  maiz: 0.12,
  trigo: 0.12,
  girasol: 0.07,
  papa: 0,
};

const RENDIMIENTOS_QQ_HA = {
  soja: [28, 32],
  maiz: [75, 90],
  trigo: [30, 40],
  girasol: [18, 24],
  papa: [300, 450],
};

const norm = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const parseCultivo = (cultivo = "") => {
  const c = norm(cultivo);
  if (c.includes("soja")) return "soja";
  if (c.includes("maiz")) return "maiz";
  if (c.includes("trigo")) return "trigo";
  if (c.includes("girasol")) return "girasol";
  if (c.includes("papa") || c.includes("patata")) return "papa";
  return "soja";
};

const fmt = (n, d = 2) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "s/d";
  return v.toLocaleString("es-AR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};

const pickTipoCambio = (rows = [], nombre = "oficial") =>
  Number(
    rows.find((r) => norm(r.tipo) === norm(nombre))?.valor ||
      rows.find((r) => norm(r.tipo).includes(norm(nombre)))?.valor
  ) || null;

const obtenerRendimiento = (usuario, cultivoClave) => {
  const cultivo = (usuario?.cultivos || []).find((c) => parseCultivo(c.cultivo) === cultivoClave);
  const q = Number(cultivo?.rendimiento_qq_ha);
  if (Number.isFinite(q) && q > 0) {
    return { rendimiento_qq_ha: q, es_estimado: false, fuente: "usuario_cultivos.rendimiento_qq_ha" };
  }
  const rango = RENDIMIENTOS_QQ_HA[cultivoClave] || RENDIMIENTOS_QQ_HA.soja;
  const estimado = Number(((rango[0] + rango[1]) / 2).toFixed(1));
  return {
    rendimiento_qq_ha: estimado,
    es_estimado: true,
    fuente: "promedio_regional",
    rango,
  };
};

const obtenerMercado = async ({ cultivoClave, usuario }) => {
  const disponible = await query(
    `
      SELECT cultivo, mercado, precio, moneda, fecha
      FROM precios
      WHERE LOWER(cultivo) = $1
      ORDER BY fecha DESC,
        CASE
          WHEN LOWER(mercado) LIKE '%cac%' THEN 1
          WHEN LOWER(mercado) LIKE '%rosario%' THEN 2
          WHEN LOWER(mercado) LIKE '%magyp%' THEN 3
          ELSE 9
        END,
        creado_en DESC
      LIMIT 1
    `,
    [cultivoClave]
  );

  const fas = await query(
    `
      SELECT cultivo, mercado, precio, moneda, fecha
      FROM precios
      WHERE LOWER(cultivo) = $1
        AND LOWER(mercado) LIKE '%magyp%'
      ORDER BY fecha DESC, creado_en DESC
      LIMIT 1
    `,
    [cultivoClave]
  );

  const futuros = await query(
    `
      SELECT fp.cultivo, fp.posicion, fp.precio_usd, fp.variacion, fp.fecha
      FROM futuros_posiciones fp
      JOIN (
        SELECT cultivo, MAX(fecha) AS fecha
        FROM futuros_posiciones
        WHERE LOWER(cultivo) = $1
        GROUP BY cultivo
      ) ult ON LOWER(fp.cultivo) = LOWER(ult.cultivo) AND fp.fecha = ult.fecha
      WHERE LOWER(fp.cultivo) = $1
      ORDER BY fp.posicion ASC
      LIMIT 3
    `,
    [cultivoClave]
  );

  const tcFecha = await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio");
  const tc = tcFecha.rows[0]?.fecha
    ? await query(
        `
          SELECT tipo, valor, fecha
          FROM tipo_cambio
          WHERE fecha = $1
        `,
        [tcFecha.rows[0].fecha]
      )
    : { rows: [] };

  const chicago = await query(
    `
      SELECT precio, moneda, mercado, fecha
      FROM precios
      WHERE LOWER(cultivo) = $1
        AND (LOWER(mercado) LIKE '%chicago%' OR LOWER(mercado) LIKE '%cbot%' OR LOWER(mercado) LIKE '%afa%')
      ORDER BY fecha DESC, creado_en DESC
      LIMIT 1
    `,
    [cultivoClave]
  );

  const tendencias = await query(
    `
      SELECT fecha, AVG(precio)::numeric(12,2) AS precio
      FROM precios
      WHERE LOWER(cultivo) = $1
      GROUP BY fecha
      ORDER BY fecha DESC
      LIMIT 31
    `,
    [cultivoClave]
  );

  const mes = new Date().getMonth() + 1;
  const estacionalidad = await query(
    `
      SELECT AVG(precio)::numeric(12,2) AS promedio_mes
      FROM precios
      WHERE LOWER(cultivo) = $1
        AND EXTRACT(MONTH FROM fecha) = $2
    `,
    [cultivoClave, mes]
  );

  const clima = usuario?.lat != null && usuario?.lng != null
    ? await query(
        `
          SELECT fecha, precipitacion, helada, descripcion
          FROM clima
          WHERE lat = $1 AND lng = $2
          ORDER BY fecha ASC
          LIMIT 7
        `,
        [usuario.lat, usuario.lng]
      )
    : { rows: [] };

  const ventas = await query(
    `
      SELECT COALESCE(SUM(cantidad), 0)::numeric(14,2) AS cantidad_vendida
      FROM ventas
      WHERE usuario_id = $1
        AND LOWER(producto) LIKE '%' || $2 || '%'
        AND date_trunc('year', fecha) = date_trunc('year', CURRENT_DATE)
    `,
    [usuario.id, cultivoClave]
  );

  return {
    precioDisponible: disponible.rows[0] || null,
    precioFas: fas.rows[0] || null,
    futuros: futuros.rows,
    tipoCambio: tc.rows,
    chicago: chicago.rows[0] || null,
    tendencia30: tendencias.rows,
    estacionalidadMes: Number(estacionalidad.rows[0]?.promedio_mes) || null,
    clima: clima.rows,
    cantidadVendida: Number(ventas.rows[0]?.cantidad_vendida) || 0,
  };
};

const construirRecomendacionLocal = (datos) => {
  const m = Number(datos.margen_pct);
  const df = Number(datos.diferencia_futuro_pct);
  if (Number.isFinite(m) && m > 25 && Number.isFinite(df) && df < 3) {
    return "Con margen sólido y premio de futuro bajo, el riesgo de esperar es alto. Si necesitás caja, conviene vender hoy. Si podés esperar, fijá 50% y dejá 50% abierto.";
  }
  if (Number.isFinite(m) && m <= 10) {
    return "El margen está ajustado. Priorizá cobertura parcial o venta escalonada para reducir riesgo de precio y tipo de cambio.";
  }
  return "Podés avanzar con estrategia escalonada (30-50% ahora y resto sujeto a mercado), monitoreando Chicago, dólar y clima semanalmente.";
};

const analizarConvenienciaVentaRaw = async (usuario, cultivo) => {
  const cultivoClave = parseCultivo(cultivo);
  const retencion = RETENCIONES[cultivoClave] ?? 0.12;

  const costo = await calcularCostoPorHa(usuario, cultivoClave);
  const rendimiento = obtenerRendimiento(usuario, cultivoClave);
  const mercado = await obtenerMercado({ cultivoClave, usuario });

  const oficial = pickTipoCambio(mercado.tipoCambio, "oficial");
  const mep = pickTipoCambio(mercado.tipoCambio, "mep") || pickTipoCambio(mercado.tipoCambio, "bolsa");
  const blue = pickTipoCambio(mercado.tipoCambio, "blue");

  let precioDisponibleUsd = null;
  if (mercado.precioDisponible) {
    const p = Number(mercado.precioDisponible.precio);
    if (mercado.precioDisponible.moneda === "USD") precioDisponibleUsd = p;
    if (mercado.precioDisponible.moneda === "ARS" && Number.isFinite(oficial) && oficial > 0) {
      precioDisponibleUsd = Number((p / oficial).toFixed(2));
    }
  }

  const futuroCercano = Number(mercado.futuros[0]?.precio_usd);
  const precioHace30 = Number(mercado.tendencia30[mercado.tendencia30.length - 1]?.precio);
  const precioHoySerie = Number(mercado.tendencia30[0]?.precio);

  const precioNetoUsd = Number.isFinite(precioDisponibleUsd)
    ? Number((precioDisponibleUsd * (1 - retencion) * 0.98).toFixed(2))
    : null;
  const rendimientoTnHa = Number((rendimiento.rendimiento_qq_ha / 10).toFixed(2));
  const ingresoPorHa = Number.isFinite(precioNetoUsd)
    ? Number((precioNetoUsd * rendimientoTnHa).toFixed(2))
    : null;
  const costoPorHa = Number(costo.costo_estimado);
  const margenUsd = Number.isFinite(ingresoPorHa)
    ? Number((ingresoPorHa - costoPorHa).toFixed(2))
    : null;
  const margenPct =
    Number.isFinite(margenUsd) && costoPorHa > 0
      ? Number(((margenUsd / costoPorHa) * 100).toFixed(2))
      : null;

  const diferenciaFuturoPct =
    Number.isFinite(futuroCercano) && Number.isFinite(precioDisponibleUsd) && precioDisponibleUsd > 0
      ? Number((((futuroCercano - precioDisponibleUsd) / precioDisponibleUsd) * 100).toFixed(2))
      : null;
  const tendencia30d =
    Number.isFinite(precioHoySerie) && Number.isFinite(precioHace30) && precioHace30 > 0
      ? Number((((precioHoySerie - precioHace30) / precioHace30) * 100).toFixed(2))
      : null;

  const riesgoClimatico = mercado.clima.some(
    (c) => c.helada || Number(c.precipitacion) > 40 || norm(c.descripcion).includes("torment")
  );

  const hectareas = Number(
    (usuario.cultivos || []).find((c) => parseCultivo(c.cultivo) === cultivoClave)?.hectareas
  ) || null;
  const produccionEstimadaTn =
    Number.isFinite(hectareas) && Number.isFinite(rendimientoTnHa)
      ? Number((hectareas * rendimientoTnHa).toFixed(2))
      : null;
  const remanenteTn =
    Number.isFinite(produccionEstimadaTn)
      ? Number((produccionEstimadaTn - Number(mercado.cantidadVendida || 0)).toFixed(2))
      : null;

  const payloadIA = {
    usuario: {
      nombre: usuario.nombre,
      zona: `${usuario.partido || "s/d"}, ${usuario.provincia || "s/d"}`,
    },
    cultivo: cultivoClave,
    precio_disponible_usd_tn: precioDisponibleUsd,
    mercado_disponible: mercado.precioDisponible?.mercado || null,
    precio_fas_usd_tn:
      mercado.precioFas?.moneda === "USD"
        ? Number(mercado.precioFas?.precio)
        : null,
    futuros_usd_tn: mercado.futuros.map((f) => ({
      posicion: f.posicion,
      precio_usd: Number(f.precio_usd),
      variacion: Number(f.variacion),
    })),
    tipo_cambio: { oficial, mep, blue },
    chicago_ref: mercado.chicago
      ? {
          precio: Number(mercado.chicago.precio),
          moneda: mercado.chicago.moneda,
          mercado: mercado.chicago.mercado,
        }
      : null,
    tendencia_30d_pct: tendencia30d,
    estacionalidad_mes_promedio: mercado.estacionalidadMes,
    retencion,
    gastos_comercializacion: 0.02,
    rendimiento_qq_ha: rendimiento.rendimiento_qq_ha,
    rendimiento_estimado: rendimiento.es_estimado,
    costo_por_ha: costoPorHa,
    costo_estimado: costo.es_estimado,
    precio_neto_usd_tn: precioNetoUsd,
    ingreso_por_ha: ingresoPorHa,
    margen_usd_ha: margenUsd,
    margen_pct: margenPct,
    diferencia_futuro_pct: diferenciaFuturoPct,
    produccion_estimada_tn: produccionEstimadaTn,
    vendido_tn: Number(mercado.cantidadVendida || 0),
    remanente_tn: remanenteTn,
    riesgo_climatico: riesgoClimatico,
  };

  let recomendacion = construirRecomendacionLocal({
    margen_pct: margenPct,
    diferencia_futuro_pct: diferenciaFuturoPct,
  });
  try {
    const ia = await generarConPromptLibre({
      system:
        "Sos un asesor agropecuario experto en comercialización de granos argentinos. Analizás si conviene vender hoy o esperar basándote en datos concretos. Siempre das una recomendación clara y accionable. Usás lenguaje simple. Nunca usás tecnicismos sin explicarlos. Siempre aclarás que es orientativo y que deben consultar con su corredor.",
      user:
        "Analizá y respondé en no más de 6 líneas, con recomendación concreta y una alternativa.\nDatos:\n" +
        JSON.stringify(payloadIA, null, 2),
    });
    if (ia?.texto) recomendacion = ia.texto.trim();
  } catch (_e) {}

  return [
    `📊 *ANÁLISIS DE VENTA - ${cultivoClave.toUpperCase()}*`,
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "💰 *PRECIO ACTUAL*",
    `Disponible ${mercado.precioDisponible?.mercado || "s/d"}: USD ${fmt(precioDisponibleUsd)}/tn`,
    `FAS teórico: USD ${fmt(
      mercado.precioFas?.moneda === "USD" ? mercado.precioFas?.precio : null
    )}/tn`,
    ...mercado.futuros.slice(0, 3).map(
      (f, i) =>
        `Futuro ${f.posicion}: USD ${fmt(f.precio_usd)}/tn${
          i === 0 && Number.isFinite(diferenciaFuturoPct)
            ? ` (${diferenciaFuturoPct >= 0 ? "+" : ""}${fmt(diferenciaFuturoPct)}%)`
            : ""
        }`
    ),
    "",
    "📈 *CONTEXTO DE MERCADO*",
    `Tendencia 30d: ${Number.isFinite(tendencia30d) ? `${tendencia30d >= 0 ? "+" : ""}${fmt(tendencia30d)}%` : "s/d"}`,
    `Estacionalidad (${new Date().toLocaleString("es-AR", { month: "long" })}): USD ${fmt(
      mercado.estacionalidadMes
    )}/tn`,
    "",
    "🌍 *FACTORES EXTERNOS*",
    `Dólar oficial: $${fmt(oficial, 0)} | MEP: $${fmt(mep, 0)} | Blue: $${fmt(blue, 0)}`,
    `Retención estimada: ${(retencion * 100).toFixed(0)}%`,
    `Chicago/CBOT ref: ${
      mercado.chicago ? `${fmt(mercado.chicago.precio)} ${mercado.chicago.moneda || ""}` : "s/d"
    }`,
    `Clima zona: ${riesgoClimatico ? "riesgo moderado/alto" : "sin alertas fuertes"}`,
    "",
    "🧮 *TU SITUACIÓN*",
    `Costo por ha: USD ${fmt(costoPorHa)}${costo.es_estimado ? " (estimado)" : ""}`,
    `Rendimiento: ${fmt(rendimiento.rendimiento_qq_ha, 1)} qq/ha${rendimiento.es_estimado ? " (estimado)" : ""}`,
    `Margen actual: USD ${fmt(margenUsd)}/ha (${fmt(margenPct)}%) ${
      Number.isFinite(margenPct) && margenPct > 0 ? "✅" : "⚠️"
    }`,
    `Vendido: ${fmt(mercado.cantidadVendida)} tn | Remanente estimado: ${fmt(remanenteTn)} tn`,
    "",
    "⚖️ *RECOMENDACIÓN*",
    recomendacion,
    "",
    "⚠️ Recordá que esto es orientativo. Consultá con tu corredor antes de decidir.",
  ].join("\n");
};

module.exports = {
  analizarConvenienciaVenta: analizarConvenienciaVentaRaw,
  analizarConvenienciaVentaRaw,
  parseCultivo,
};
