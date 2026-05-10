const axios = require("axios");
const cheerio = require("cheerio");

const URLS = [
  "https://www.mcba.gob.ar/precios-de-referencia",
  "https://www.mcba.gob.ar/ingresos",
  "https://www.mcba.gob.ar",
];

const parseNumero = (txt = "") => {
  const clean = String(txt || "").replace(/[^\d.,-]/g, "");
  if (!clean) return null;
  let normalized = clean;
  if (clean.includes(",") && clean.includes(".")) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    normalized = clean.replace(",", ".");
  } else if (clean.includes(".")) {
    const parts = clean.split(".");
    if (!(parts.length === 2 && parts[1].length <= 3)) {
      normalized = clean.replace(/\./g, "");
    }
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const fechaHoyAr = () =>
  new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

const nivelIngresoDesdeCamiones = (camiones) => {
  const c = Number(camiones);
  if (!Number.isFinite(c)) return "s/d";
  if (c > 80) return "alto";
  if (c > 50) return "medio";
  return "bajo";
};

const extraerCamiones = ($) => {
  const bodyTxt = $("body").text().replace(/\s+/g, " ").trim();
  const mCam = bodyTxt.match(/camiones?(?:\s+negociados|\s+ingresados)?\s*[:\-]?\s*([0-9\.,]+)/i);
  const cam = parseNumero(mCam?.[1] || "");
  return Number.isFinite(cam) ? cam : null;
};

const extraerPreciosPapa = ($, fecha, camionesTotal) => {
  const out = [];
  const volumenNivel = nivelIngresoDesdeCamiones(camionesTotal);

  $("table tr").each((_, tr) => {
    const cols = $(tr)
      .find("th,td")
      .map((__, td) => $(td).text().trim())
      .get();
    if (cols.length < 3) return;
    const rowTxt = cols.join(" ").toLowerCase();
    if (!rowTxt.includes("papa")) return;

    const nums = cols.map((c) => parseNumero(c)).filter(Number.isFinite);
    if (!nums.length) return;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const prom = (min + max) / 2;

    out.push({
      cultivo: "papa",
      mercado: "MCBA_OFICIAL",
      precio_ars: Number((prom * 1000).toFixed(2)),
      precio_usd: null,
      tipo_precio: "referencia",
      calidad: "s/d",
      presentacion: "s/d",
      volumen_ingreso_nivel: volumenNivel,
      volumen_ingreso_fuente: "mcba",
      camiones_total: Number.isFinite(camionesTotal) ? Number(camionesTotal) : null,
      toneladas_estimadas: Number.isFinite(camionesTotal) ? Number((camionesTotal * 27).toFixed(2)) : null,
      fecha,
    });
  });

  return out;
};

const obtenerPreciosPapaMcba = async () => {
  const fecha = fechaHoyAr();
  const errores = [];
  const items = [];

  for (const url of URLS) {
    try {
      const response = await axios.get(url, {
        timeout: 20_000,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { "User-Agent": "AgroHabilis/1.0" },
      });
      const $ = cheerio.load(String(response.data || ""));
      const camionesTotal = extraerCamiones($);
      const rows = extraerPreciosPapa($, fecha, camionesTotal);
      items.push(...rows);
      if (rows.length) break;
    } catch (error) {
      errores.push(`${url}: ${error.message}`);
    }
  }

  const unicos = new Map();
  for (const it of items) {
    const k = `${it.cultivo}_${it.mercado}_${it.fecha}`;
    if (!unicos.has(k)) unicos.set(k, it);
  }

  return {
    items: Array.from(unicos.values()),
    errores,
  };
};

module.exports = {
  obtenerPreciosPapaMcba,
};
