"use strict";

const etiquetaMesAnio = (mes, anio) => {
  const mm = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${mm[mes - 1] || "Mes"} ${anio || ""}`.trim();
};

const porcentaje = (v) => {
  if (!Number.isFinite(v)) return "s/d";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
};

const clasificarFrecuencia = (fechaISO) => {
  if (!fechaISO) return "sin fecha";
  const d = new Date(`${fechaISO}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "sin fecha";
  const hoy = new Date();
  const diffMs = hoy.getTime() - d.getTime();
  const diffDias = Math.floor(diffMs / 86_400_000);
  if (diffDias <= 0) return "intradiario/cierre del día";
  if (diffDias === 1) return "cierre (delay 24 hs)";
  return `histórico (delay ${diffDias} días)`;
};

const resolverFuenteMercado = (mercado = "", normMin) => {
  const m = normMin(mercado);
  if (m.includes("todoagro")) return "https://www.todoagro.com.ar/mercados/";
  if (m.includes("infocampo")) return "https://www.infocampo.com.ar/category/mercados-y-empresas/";
  if (m.includes("cac")) return "https://www.cac.bcr.com.ar/es/precios";
  if (m.includes("afa")) return "https://www.acopiarsa.com.ar/matba.asp";
  return null;
};

const responderCoberturaMaiz = async ({ pregunta = "", tecnico = false } = {}, deps = {}) => {
  const {
    queryFn: query,
    toISODateParamFn: toISODateParam,
    formatearMonedaFn: formatearMoneda,
    extraerPosicionesSolicitadasFn: extraerPosicionesSolicitadas,
    parseMesAnioPosicionFn: parseMesAnioPosicion,
    normMinFn: normMin,
  } = deps;
  const fechaDispR = await query(
    `
      SELECT MAX(fecha) AS fecha
      FROM precios
      WHERE LOWER(cultivo)=LOWER('maiz')
        AND LOWER(COALESCE(mercado,'')) LIKE '%ros%'
    `
  );
  const fechaDisp = toISODateParam(fechaDispR.rows[0]?.fecha);
  if (!fechaDisp) return null;

  const spotR = await query(
    `
      SELECT mercado, precio, moneda, creado_en
      FROM precios
      WHERE LOWER(cultivo)=LOWER('maiz')
        AND fecha = $1::date
        AND LOWER(COALESCE(mercado,'')) LIKE '%ros%'
      ORDER BY precio ASC
    `,
    [fechaDisp]
  );
  if (!spotR.rows.length) return null;
  const preciosSpot = spotR.rows.map((r) => Number(r.precio)).filter(Number.isFinite);
  if (!preciosSpot.length) return null;
  const spotMin = Math.min(...preciosSpot);
  const spotMax = Math.max(...preciosSpot);
  const spotRef = (spotMin + spotMax) / 2;
  const spotFuenteRaw = String(spotR.rows[0]?.mercado || "");
  const spotFuenteLink = resolverFuenteMercado(spotFuenteRaw, normMin) || "https://www.cac.bcr.com.ar/es/precios";

  const tcR = await query(
    `
      SELECT valor, tipo, fecha
      FROM tipo_cambio
      WHERE LOWER(tipo) IN ('mep', 'bolsa')
      ORDER BY fecha DESC
      LIMIT 1
    `
  );
  const tc = Number(tcR.rows[0]?.valor);
  const tcFecha = toISODateParam(tcR.rows[0]?.fecha);

  const futR = await query(
    `
      SELECT posicion, precio_usd, variacion, volumen, fecha
      FROM futuros_posiciones
      WHERE LOWER(cultivo)=LOWER('maiz')
      ORDER BY fecha DESC
      LIMIT 30
    `
  );
  if (!futR.rows.length) return null;
  const futFecha = toISODateParam(futR.rows[0]?.fecha);
  const mesesSolicitados = extraerPosicionesSolicitadas(pregunta);
  const nowYear = new Date().getFullYear();
  const futurosNormalizados = futR.rows
    .map((r) => {
      const pa = parseMesAnioPosicion(r.posicion);
      const usd = Number(r.precio_usd);
      if (!pa || !Number.isFinite(usd)) return null;
      const anio = pa.anio || (pa.mes >= 7 ? nowYear : nowYear + 1);
      return {
        mes: pa.mes,
        anio,
        usd,
        variacion: Number.isFinite(Number(r.variacion)) ? Number(r.variacion) : null,
        volumen: Number.isFinite(Number(r.volumen)) ? Number(r.volumen) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));

  const filtradosPorSolicitud = mesesSolicitados.length
    ? futurosNormalizados.filter((f) => mesesSolicitados.includes(f.mes))
    : [];
  const objetivoDefault = futurosNormalizados.filter((f) => (f.mes === 4 || f.mes === 12)).slice(0, 4);
  const futuros = (filtradosPorSolicitud.length ? filtradosPorSolicitud : objetivoDefault).slice(0, 6);

  const disponibleUsd = Number.isFinite(tc) && tc > 0 ? spotRef / tc : null;
  const brechas = futuros.map((f) => ({
    ...f,
    diff: Number.isFinite(disponibleUsd) ? ((f.usd - disponibleUsd) / disponibleUsd) * 100 : null,
  }));
  const faltantesComparabilidad = [];
  if (!Number.isFinite(disponibleUsd)) faltantesComparabilidad.push("spot Rosario convertido a USD con MEP/Bolsa");
  if (!futuros.length) faltantesComparabilidad.push("posiciones MATBA comparables");
  const inconsistente = brechas.some((b) => Number.isFinite(b.diff) && Math.abs(b.diff) > 30);
  const puedeRecomendar = faltantesComparabilidad.length === 0 && !inconsistente;

  const fuentesMercado = [...new Set(
    spotR.rows.map((r) => resolverFuenteMercado(r.mercado, normMin)).filter(Boolean)
  )];
  const fuentes = [
    ...fuentesMercado,
    "https://www.acopiarsa.com.ar/matba.asp",
    "https://www.maroun.com.ar/",
    "https://dataportuaria.ar/nota/25460/las-existencias-de-maiz-alcanzaron-un-record-historico-de-19-3-millones-de-toneladas-al-primero-de-abril/",
  ];
  const actualizado = new Date().toLocaleString("es-AR", {
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const freqSpot = clasificarFrecuencia(fechaDisp);
  const freqFut = clasificarFrecuencia(futFecha);
  const freqTc = clasificarFrecuencia(tcFecha);
  const sinMatbaDirecto = !futuros.length;
  const matbaTieneVariacion = futuros.some((f) => Number.isFinite(f.variacion));
  const matbaTieneVolumen = futuros.some((f) => Number.isFinite(f.volumen));

  const lines = [
    "📊 Referencia mercado (actual)",
    `Rosario disponible - Fuente ${spotR.rows[0]?.mercado || "BCR/CAC"}: ${formatearMoneda(spotRef, "ARS")}/t (rango ${formatearMoneda(spotMin, "ARS")} - ${formatearMoneda(spotMax, "ARS")})`,
    `Tipo de dato: spot disponible`,
    `Frecuencia: ${freqSpot}`,
    "",
    "📈 MATBA ROFEX maíz",
    ...(sinMatbaDirecto
      ? ["No tengo acceso directo a MATBA en este momento."]
      : [
          ...futuros.map(
            (f) => `${etiquetaMesAnio(f.mes, f.anio)} - MATBA ROFEX - Ajuste: USD ${f.usd.toFixed(1)}/t`
          ),
          "Tipo de dato: ajuste (cierre de rueda) en `precio_usd`",
          `Último operado: ${matbaTieneVariacion ? "no disponible explícito en base (solo variación)" : "no disponible en base"}`,
          `Comprador/Vendedor: no disponible en base`,
          `Datos complementarios: variación ${matbaTieneVariacion ? "sí" : "no"} | volumen ${matbaTieneVolumen ? "sí" : "no"}`,
          `Frecuencia: ${freqFut}`,
        ]),
    "",
    "💱 Tipo de cambio usado",
    Number.isFinite(tc) ? `TC usado: ${String(tcR.rows[0]?.tipo || "MEP").toUpperCase()} ${formatearMoneda(tc, "ARS")}` : "TC usado: sin datos",
    `Frecuencia: ${freqTc}`,
    "",
    "📐 Cálculo transparente",
    ...(Number.isFinite(disponibleUsd)
      ? [
          `Disponible USD = ${spotRef.toFixed(2)} / ${tc.toFixed(2)} = ${disponibleUsd.toFixed(1)} USD/t`,
          "",
          ...(brechas.length
            ? brechas.map(
                (b) =>
                  `${etiquetaMesAnio(b.mes, b.anio)} = ${b.usd.toFixed(1)} USD/t -> Spread = ${porcentaje(b.diff)}`
              )
            : ["Sin posiciones MATBA comparables para calcular spread."]),
        ]
      : ["No pude calcular relación USD porque no encontré tipo de cambio MEP/bolsa disponible."]),
    ...(inconsistente
      ? [
          "",
          "⚠️ Control de consistencia:",
          "- Detecté spread fuera de rango razonable (>30%) para al menos una posición.",
          "- No emito recomendación operativa hasta validar condición de entrega, referencia y tipo de cambio implícito.",
        ]
      : []),
    "",
    "📌 Lectura técnica (corta):",
    ...(puedeRecomendar
      ? [
          "- Si la curva está arriba del spot en USD, tenés carry positivo (contango moderado).",
          "- Con stock alto, el spot suele quedar presionado.",
          "- Si la prima no es grande, conviene cobertura parcial y no total.",
        ]
      : [
          "- Con la comparabilidad actual, solo corresponde lectura descriptiva.",
          "- Faltan datos o consistencia para definir timing fino.",
        ]),
    "",
    "📍 Conclusión operativa:",
    ...(puedeRecomendar
      ? [
          "- No parece contexto para vender todo spot agresivo.",
          "- Cobertura parcial (20-30% entre dic/abr) puede tener sentido y dejar resto abierto.",
        ]
      : [
          `- No recomiendo ejecutar cobertura ahora: falta ${faltantesComparabilidad.join(", ") || "validación de consistencia"} .`,
          "- Si necesitás decidir hoy, usá solo cobertura mínima defensiva y recalculamos con datos comparables.",
        ]),
    "",
    `Actualizado: ${actualizado} hs`,
    "",
    "---------------------",
    "Fuentes:",
    ...fuentes.map((f) => `- ${f}`),
    "",
    `- ${spotFuenteLink}`,
    `Fecha base disponible: ${fechaDisp}${futFecha ? ` | Fecha futuros: ${futFecha}` : ""}${tcFecha ? ` | Tipo de cambio: ${tcFecha}` : ""}`,
  ];

  if (tecnico) {
    const curvaTxt = futuros.length
      ? futuros.map((f) => `- ${etiquetaMesAnio(f.mes, f.anio)}: USD ${f.usd.toFixed(1)}`).join("\n")
      : "- Sin curva disponible.";
    const basis = Number.isFinite(disponibleUsd) && futuros[0]
      ? (disponibleUsd - futuros[0].usd)
      : null;
    lines.push(
      "",
      "🧪 MODO TECNICO ON",
      "Curva completa (resumen):",
      curvaTxt,
      `Basis rápido (Spot USD - 1er futuro): ${Number.isFinite(basis) ? `${basis.toFixed(1)} USD/t` : "s/d"}`,
      "Spreads: ver bloque de cálculo transparente."
    );
  }

  return lines.join("\n");
};

module.exports = { responderCoberturaMaiz };
