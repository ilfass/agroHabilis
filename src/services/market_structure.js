const { query } = require("../config/database");
const { obtenerDisponiblePoliticaResumenUnCultivo } = require("./disponible_politica_resumen");

const norm = (v = "") =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const parseMesAnioPosicion = (posicion = "") => {
  const p = norm(posicion).replace(/\s+/g, " ").trim();
  const map = {
    ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
    may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
    sep: 9, set: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10,
    nov: 11, noviembre: 11, dic: 12, diciembre: 12,
  };
  const m1 = p.match(/\b(\d{1,2})\s*\/\s*(20\d{2})\b/);
  if (m1) {
    const mes = Number(m1[1]);
    const anio = Number(m1[2]);
    if (mes >= 1 && mes <= 12) return { mes, anio };
  }
  const m2 = p.match(/\b([a-z]+)\b(?:\s+|\/)?(20\d{2})?/);
  if (m2) {
    const mes = map[m2[1]];
    if (!mes) return null;
    return { mes, anio: Number(m2[2]) || null };
  }
  return null;
};

const etiquetaMesAnio = (mes, anio) => {
  const mm = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${mm[mes - 1] || "Mes"} ${anio || ""}`.trim();
};

const porcentaje = (v) => {
  if (!Number.isFinite(v)) return "s/d";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
};

const toISODate = (v) => {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
};

const calcularEstructuraMercado = async ({
  producto,
  mesesSolicitados = [],
  sanityPct = 30,
} = {}) => {
  const cultivo = norm(producto);
  if (!cultivo) return null;
  const relationMissing = (error) =>
    error && (error.code === "42P01" || /precios_normalizados/i.test(String(error.message || "")));

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
  const tcTipo = String(tcR.rows[0]?.tipo || "MEP").toUpperCase();
  const tcFecha = toISODate(tcR.rows[0]?.fecha);

  let spotFechaR;
  try {
    spotFechaR = await query(
      `
        SELECT MAX(fecha_mercado) AS fecha
        FROM precios_normalizados
        WHERE producto = $1
          AND tipo_registro = 'spot'
          AND plaza = 'rosario'
          AND moneda = 'ARS'
      `,
      [cultivo]
    );
  } catch (error) {
    if (relationMissing(error)) {
      return {
        ok: false,
        estado: "bloqueado_faltantes",
        cultivo,
        faltantes: ["tabla canónica precios_normalizados (migración pendiente)"],
        inconsistente: false,
        texto:
          "No puedo calcular estructura comparable porque falta la tabla canónica de mercado. Ejecutá la migración 20260430_market_structure.sql y vuelvo a calcular sin mezclar fuentes.",
      };
    }
    throw error;
  }
  const spotFecha = toISODate(spotFechaR.rows[0]?.fecha);
  let spotUsd = null;
  let spotArs = null;
  let spotMercado = null;
  if (spotFecha) {
    const spotR = await query(
      `
        SELECT mercado, precio
        FROM precios_normalizados
        WHERE producto = $1
          AND tipo_registro = 'spot'
          AND plaza = 'rosario'
          AND moneda = 'ARS'
          AND fecha_mercado = $2::date
        ORDER BY precio ASC
      `,
      [cultivo, spotFecha]
    );
    const spotVals = (spotR.rows || []).map((x) => Number(x.precio)).filter(Number.isFinite);
    if (spotVals.length) {
      spotArs = (Math.min(...spotVals) + Math.max(...spotVals)) / 2;
      spotMercado = spotR.rows[0]?.mercado || "ROSARIO";
      if (Number.isFinite(tc) && tc > 0) spotUsd = spotArs / tc;
    }
  }

  let spotFechaRef = spotFecha;
  if (!Number.isFinite(spotArs)) {
    const row = await obtenerDisponiblePoliticaResumenUnCultivo(cultivo);
    if (row && String(row.moneda || "").toUpperCase() === "ARS" && Number.isFinite(Number(row.precio))) {
      spotArs = Number(row.precio);
      spotMercado = String(row.mercado || "precios").replace(/_/g, " ");
      spotFechaRef = toISODate(row.fecha);
      if (Number.isFinite(tc) && tc > 0) spotUsd = spotArs / tc;
    }
  }

  const futFechaR = await query(
    `
      SELECT MAX(fecha_mercado) AS fecha
      FROM precios_normalizados
      WHERE producto = $1
        AND tipo_registro = 'future'
        AND mercado = 'MATBA_ROFEX'
        AND moneda = 'USD'
    `,
    [cultivo]
  );
  let futFecha = toISODate(futFechaR.rows[0]?.fecha);
  let futuros = [];
  if (futFecha) {
    const futR = await query(
      `
        SELECT posicion, precio
        FROM precios_normalizados
        WHERE producto = $1
          AND tipo_registro = 'future'
          AND mercado = 'MATBA_ROFEX'
          AND moneda = 'USD'
          AND fecha_mercado = $2::date
        ORDER BY posicion
      `,
      [cultivo, futFecha]
    );
    const nowYear = new Date().getFullYear();
    futuros = (futR.rows || [])
      .map((r) => {
        const pa = parseMesAnioPosicion(r.posicion || "");
        const usd = Number(r.precio);
        if (!pa || !Number.isFinite(usd)) return null;
        return {
          posicion: r.posicion || null,
          mes: pa.mes,
          anio: pa.anio || (pa.mes >= 7 ? nowYear : nowYear + 1),
          usd,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));
  }

  if (!futuros.length) {
    const legF = await query(
      `
        SELECT MAX(fecha) AS fecha
        FROM futuros_posiciones
        WHERE LOWER(cultivo) = LOWER($1)
      `,
      [cultivo]
    );
    futFecha = toISODate(legF.rows[0]?.fecha);
    if (futFecha) {
      const legR = await query(
        `
          SELECT posicion, precio_usd
          FROM futuros_posiciones
          WHERE LOWER(cultivo) = LOWER($1)
            AND fecha = $2::date
          ORDER BY posicion
        `,
        [cultivo, futFecha]
      );
      const nowYear = new Date().getFullYear();
      futuros = (legR.rows || [])
        .map((r) => {
          const pa = parseMesAnioPosicion(r.posicion || "");
          const usd = Number(r.precio_usd);
          if (!pa || !Number.isFinite(usd)) return null;
          return {
            posicion: r.posicion || null,
            mes: pa.mes,
            anio: pa.anio || (pa.mes >= 7 ? nowYear : nowYear + 1),
            usd,
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));
    }
  }

  const futurosFiltrados = mesesSolicitados.length
    ? futuros.filter((f) => mesesSolicitados.includes(f.mes))
    : futuros.slice(0, 6);

  const faltantes = [];
  if (!Number.isFinite(spotArs)) faltantes.push("spot Rosario ARS");
  if (!Number.isFinite(tc) || tc <= 0) faltantes.push("tipo de cambio MEP/Bolsa");
  if (!futurosFiltrados.length) faltantes.push("futuros MATBA/ROFEX comparables");
  if (faltantes.length) {
    return {
      ok: false,
      estado: "bloqueado_faltantes",
      cultivo,
      faltantes,
      inconsistente: false,
      texto: [
        `No tengo base comparable completa para ${cultivo.toUpperCase()}.`,
        `Falta: ${faltantes.join(", ")}.`,
        "Sin esos datos no calculo spread/carry/backwardation para evitar mezclar fuentes o unidades.",
        "Si querés, te paso solo tendencia y referencias disponibles sin recomendación operativa.",
      ].join("\n"),
    };
  }

  const filas = futurosFiltrados.map((f) => {
    const spreadPct = ((f.usd - spotUsd) / spotUsd) * 100;
    const estructura = spreadPct > 0 ? "carry" : spreadPct < 0 ? "backwardation" : "paridad";
    const basis = spotUsd - f.usd;
    return { ...f, spreadPct, basis, estructura };
  });
  const inconsistente = filas.some((f) => Math.abs(f.spreadPct) > sanityPct);
  const avisoSpread =
    inconsistente
      ? `Atención: hay al menos un spread >${sanityPct}% respecto del spot en USD — revisá fechas/fuentes antes de operar.`
      : null;

  const detalle = filas
    .map(
      (f) =>
        `${etiquetaMesAnio(f.mes, f.anio)}: Futuro ${f.usd.toFixed(2)} USD/t | spread ${porcentaje(
          f.spreadPct
        )} | basis ${f.basis.toFixed(2)} USD/t -> ${f.estructura}`
    )
    .join("\n");
  const primera = filas[0];
  const lectura =
    primera.spreadPct > 0
      ? "curva en carry (futuros arriba del spot)"
      : primera.spreadPct < 0
      ? "curva en backwardation (futuros debajo del spot)"
      : "curva en paridad spot/futuro";

  return {
    ok: true,
    estado: inconsistente ? "advertencia_spread" : "ok",
    cultivo,
    faltantes: [],
    inconsistente,
    modo: "analitico",
    texto: [
      `Estructura comparable ${cultivo.toUpperCase()} (spot en ARS con ${tcTipo} para pasar a USD; futuros MATBA).`,
      `Spot (${spotMercado || "referencia"}): ${spotArs.toFixed(2)} ARS/t -> ${spotUsd.toFixed(2)} USD/t`,
      detalle,
      `Lectura: ${lectura}.`,
      avisoSpread || "",
      "Postura prudente: operar en tramos (20-40%) y revalidar; si el implícito está lejos del MEP, sumá lectura cambiaria al carry.",
      `Fechas: spot ${spotFechaRef || spotFecha || "s/d"} | futuros ${futFecha || "s/d"} | tc ${tcFecha || "s/d"}.`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
};

module.exports = {
  calcularEstructuraMercado,
};
