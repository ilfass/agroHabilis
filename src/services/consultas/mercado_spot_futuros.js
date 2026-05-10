"use strict";

const parseMesAnioPosicion = (posicion = "", deps = {}) => {
  const { normMinFn: normMin } = deps;
  const p = normMin(posicion).replace(/\s+/g, " ").trim();
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
  const m2 = p.match(/\b([a-záéíóúñ]+)\b(?:\s+|\/)?(20\d{2})?/);
  if (m2) {
    const mes = map[m2[1]];
    if (mes) {
      const anio = Number(m2[2]) || null;
      return { mes, anio };
    }
  }
  return null;
};

const resolverSpotRosarioComparable = async (cultivo = "", deps = {}) => {
  const { queryFn: query, toISODateParamFn: toISODateParam } = deps;
  const fechaR = await query(
    `
      SELECT MAX(fecha) AS fecha
      FROM precios
      WHERE LOWER(cultivo)=LOWER($1)
        AND LOWER(COALESCE(mercado,'')) LIKE '%ros%'
        AND moneda = 'ARS'
    `,
    [cultivo]
  );
  const fecha = toISODateParam(fechaR.rows[0]?.fecha);
  if (!fecha) return null;
  const spotR = await query(
    `
      SELECT mercado, precio, moneda
      FROM precios
      WHERE LOWER(cultivo)=LOWER($1)
        AND fecha = $2::date
        AND LOWER(COALESCE(mercado,'')) LIKE '%ros%'
        AND moneda = 'ARS'
      ORDER BY precio ASC
    `,
    [cultivo, fecha]
  );
  if (!spotR.rows.length) return null;
  const valores = spotR.rows.map((r) => Number(r.precio)).filter(Number.isFinite);
  if (!valores.length) return null;
  return {
    fecha,
    mercado: spotR.rows[0]?.mercado || "Rosario",
    ars: (Math.min(...valores) + Math.max(...valores)) / 2,
  };
};

const resolverFuturosCultivo = async (cultivo = "", mesesSolicitados = [], deps = {}) => {
  const { queryFn: query, toISODateParamFn: toISODateParam, normMinFn: normMin } = deps;
  const futR = await query(
    `
      SELECT posicion, precio_usd, fecha
      FROM futuros_posiciones
      WHERE LOWER(cultivo)=LOWER($1)
      ORDER BY fecha DESC
      LIMIT 60
    `,
    [cultivo]
  );
  if (!futR.rows.length) return { fecha: null, items: [] };
  const fecha = toISODateParam(futR.rows[0]?.fecha);
  const nowYear = new Date().getFullYear();
  const normalizados = futR.rows
    .map((r) => {
      const pa = parseMesAnioPosicion(r.posicion, { normMinFn: normMin });
      const usd = Number(r.precio_usd);
      if (!pa || !Number.isFinite(usd)) return null;
      const anio = pa.anio || (pa.mes >= 7 ? nowYear : nowYear + 1);
      return { mes: pa.mes, anio, usd };
    })
    .filter(Boolean)
    .sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));
  const filtrados = mesesSolicitados.length
    ? normalizados.filter((f) => mesesSolicitados.includes(f.mes))
    : normalizados.slice(0, 4);
  return { fecha, items: filtrados };
};

module.exports = {
  parseMesAnioPosicion,
  resolverSpotRosarioComparable,
  resolverFuturosCultivo,
};
