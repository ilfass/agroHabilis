const axios = require("axios");

const URL_MAGYP_FOB =
  "https://www.magyp.gob.ar/sitio/areas/ss_mercados_agropecuarios/ws/ssma/precios_fob.php";

const CULTIVO_BY_HS4 = {
  "1001": "Trigo",
  "1005": "Maíz",
  "1007": "Sorgo",
  "1201": "Soja",
  "1206": "Girasol",
};

const toYmd = (dateLike) => {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const ymdToDmy = (ymd) => {
  const [yyyy, mm, dd] = String(ymd).split("-");
  return `${dd}/${mm}/${yyyy}`;
};

const fetchByFechaYmd = async (ymd) => {
  const fechaParam = ymdToDmy(ymd);
  const response = await axios.get(URL_MAGYP_FOB, {
    params: { Fecha: fechaParam },
    timeout: 60_000,
    headers: { "User-Agent": "Mozilla/5.0 (AgroHabilis/1.0)" },
    validateStatus: (s) => s === 200,
  });

  let payload = response.data;
  if (typeof payload === "string") {
    payload = payload.trim();
    payload = payload ? JSON.parse(payload) : [];
  }

  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.posts)
    ? payload.posts
    : [];
};

const obtenerPreciosMAGYPFOB = async ({ fecha, lookbackDays = 5 } = {}) => {
  const start = fecha ? new Date(`${fecha}T00:00:00Z`) : new Date();
  if (Number.isNaN(start.getTime())) {
    throw new Error("Fecha invalida para MAGYP FOB");
  }

  let posts = [];
  let fechaUtilizada = null;
  for (let i = 0; i <= lookbackDays; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    const rows = await fetchByFechaYmd(ymd);
    if (rows.length) {
      posts = rows;
      fechaUtilizada = ymd;
      break;
    }
  }

  if (!posts.length) return [];

  const out = [];
  for (const p of posts) {
    const posicion = String(p.posicion || "");
    const hs4 = posicion.slice(0, 4);
    const cultivo = CULTIVO_BY_HS4[hs4];
    if (!cultivo) continue;

    const fechaPost = toYmd(p.fecha);
    const precioUsd = Number(p.precio);
    if (!fechaPost || !Number.isFinite(precioUsd)) continue;

    out.push({
      cultivo,
      mercado: "magyp_fob_oficial",
      precio_ars: null,
      precio_usd: precioUsd,
      fecha: fechaPost,
      posicion,
      circular: p.circular || null,
      mes_desde: p.mesDesde ?? null,
      anio_desde: p.añoDesde ?? null,
      mes_hasta: p.mesHasta ?? null,
      anio_hasta: p.añoHasta ?? null,
    });
  }
  return out.map((r) => ({ ...r, fecha_consulta: fechaUtilizada }));
};

module.exports = {
  obtenerPreciosMAGYPFOB,
};
