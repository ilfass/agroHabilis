const axios = require("axios");
const { query } = require("../config/database");
const { obtenerPreciosCAC } = require("../scrapers/granos_cac");
const { obtenerTipoCambio } = require("../scrapers/dolar");
const { obtenerClima } = require("../scrapers/clima");

const formatearPrecio = (numero) => {
  const n = Number(numero);
  if (!Number.isFinite(n)) return "s/d";
  return `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n)}`;
};

const formatearUSD = (numero) => {
  const n = Number(numero);
  if (!Number.isFinite(n)) return "s/d";
  return `USD ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n)}`;
};

const variacion = (actual, anterior) => {
  const a = Number(actual);
  const b = Number(anterior);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return "→ sin cambios";
  const pct = Number((((a - b) / b) * 100).toFixed(1));
  if (pct > 0) return `▲ +${pct}%`;
  if (pct < 0) return `▼ ${pct}%`;
  return "→ sin cambios";
};

const esFresco = (fecha, maxHoras = 4) => {
  if (!fecha) return false;
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return false;
  const diffMs = Date.now() - d.getTime();
  return diffMs <= maxHoras * 60 * 60 * 1000;
};

const normalizar = (t = "") =>
  String(t)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const obtenerPrecioFresco = async (cultivo, maxHoras = 4) => {
  const cultivoNorm = normalizar(cultivo);
  const local = await query(
    `
      SELECT cultivo, mercado, precio, moneda, fecha
      FROM precios
      WHERE LOWER(cultivo) = $1
      ORDER BY fecha DESC
      LIMIT 1
    `,
    [cultivoNorm]
  );
  const row = local.rows[0];
  if (row && esFresco(row.fecha, maxHoras)) {
    return { ...row, fuente: "bd" };
  }

  const cac = await obtenerPreciosCAC();
  const hit = cac.find((x) => normalizar(x.cultivo).includes(cultivoNorm));
  if (!hit) return row ? { ...row, fuente: "bd_stale" } : null;

  const precio = Number.isFinite(Number(hit.precio_ars)) ? Number(hit.precio_ars) : Number(hit.precio_usd);
  const moneda = Number.isFinite(Number(hit.precio_ars)) ? "ARS" : "USD";
  await query(
    `
      INSERT INTO precios (cultivo, mercado, precio, moneda, fecha)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (cultivo, mercado, fecha) DO NOTHING
    `,
    [hit.cultivo, hit.mercado || "rosario_cac", precio, moneda, hit.fecha]
  );
  return {
    cultivo: hit.cultivo,
    mercado: hit.mercado || "rosario_cac",
    precio,
    moneda,
    fecha: hit.fecha,
    fuente: "vivo_cac",
  };
};

const obtenerDolarFresco = async (maxHoras = 2) => {
  const local = await query(
    `
      SELECT tipo, valor, fecha
      FROM tipo_cambio
      ORDER BY fecha DESC
      LIMIT 6
    `
  );
  const latest = local.rows[0];
  if (latest && esFresco(latest.fecha, maxHoras)) {
    return { items: local.rows, fuente: "bd" };
  }
  const vivo = await obtenerTipoCambio();
  for (const item of vivo) {
    await query(
      `
        INSERT INTO tipo_cambio (tipo, valor, fecha)
        VALUES ($1, $2, $3)
        ON CONFLICT (tipo, fecha) DO NOTHING
      `,
      [item.tipo, Number(item.venta), item.fecha]
    );
  }
  return {
    items: vivo.map((x) => ({ tipo: x.tipo, valor: Number(x.venta), fecha: x.fecha })),
    fuente: "vivo_dolarapi",
  };
};

const obtenerClimaFresco = async (lat, lng, maxHoras = 3) => {
  const local = await query(
    `
      SELECT fecha, temp_min, temp_max, precipitacion, helada, descripcion
      FROM clima
      WHERE ABS(lat - $1::numeric) < 0.15
        AND ABS(lng - $2::numeric) < 0.15
      ORDER BY fecha ASC
      LIMIT 7
    `,
    [lat, lng]
  );
  const latest = local.rows[local.rows.length - 1];
  if (latest && esFresco(latest.fecha, maxHoras)) {
    return { items: local.rows, fuente: "bd" };
  }
  const vivo = await obtenerClima(lat, lng);
  for (const item of vivo) {
    await query(
      `
        INSERT INTO clima (lat, lng, fecha, temp_min, temp_max, precipitacion, helada, descripcion)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (lat, lng, fecha) DO NOTHING
      `,
      [lat, lng, item.fecha, item.temp_min, item.temp_max, item.precipitacion, item.helada, item.descripcion]
    );
  }
  return { items: vivo, fuente: "vivo_openmeteo" };
};

const obtenerNoticiasFrescas = async (categorias = [], limite = 3) => {
  const keys = categorias.map((k) => normalizar(k)).filter(Boolean);
  const noticias = await query(
    `
      SELECT fuente, titulo, publicado_en
      FROM noticias_agro
      WHERE COALESCE(publicado_en, creado_en) >= NOW() - INTERVAL '24 hours'
      ORDER BY COALESCE(publicado_en, creado_en) DESC
      LIMIT 50
    `
  );
  const ranked = (noticias.rows || [])
    .map((n) => {
      const t = normalizar(n.titulo);
      const match = keys.some((k) => t.includes(k));
      const score = (match ? 2 : 0) + (/(agro|campo|ganad|hacienda|grano|maiz|soja|trigo)/.test(t) ? 1 : 0);
      return { ...n, score };
    })
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, limite).map((n) => n.titulo);
};

const separador = () => "━━━━━━━━━━━━━━━━━━━━━━━";

module.exports = {
  formatearPrecio,
  formatearUSD,
  variacion,
  esFresco,
  obtenerPrecioFresco,
  obtenerDolarFresco,
  obtenerClimaFresco,
  obtenerNoticiasFrescas,
  separador,
};
