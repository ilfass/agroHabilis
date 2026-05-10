const axios = require("axios");
const cheerio = require("cheerio");

const URLS = [
  "http://www.mercadoagroganadero.com.ar/dll/inicio.dll",
  "https://www.mercadodeliniers.com.ar",
];
const CATEGORIAS_OBJETIVO = ["novillo", "vaca", "ternero", "vaquillona", "toro"];

const normalizar = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const parseNumero = (txt = "") => {
  const clean = String(txt).replace(/[^\d.,-]/g, "");
  if (!clean) return null;
  const n = Number(clean.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const extraerFilasDesdeTabla = ($) => {
  const filas = [];
  $("table tr").each((_, tr) => {
    const cols = $(tr)
      .find("th,td")
      .map((__, c) => $(c).text().trim())
      .get();
    if (cols.length >= 3) filas.push(cols);
  });
  return filas;
};

const mapearCategoria = (texto = "") => {
  const t = normalizar(texto);
  if (t.includes("novillo")) return "novillo";
  if (t.includes("vaca")) return "vaca";
  if (t.includes("ternero")) return "ternero";
  if (t.includes("vaquillona")) return "vaquillona";
  if (t.includes("toro")) return "toro";
  return null;
};

const extraerDesdeHtml = (html) => {
  const $ = cheerio.load(html);
  const fecha = new Date().toISOString().slice(0, 10);
  const filas = extraerFilasDesdeTabla($);
  const out = [];

  for (const fila of filas) {
    const categoria = mapearCategoria(fila[0] || "");
    if (!categoria) continue;
    const nums = fila.map(parseNumero).filter((n) => Number.isFinite(n));
    if (nums.length < 2) continue;
    const precioMin = Math.min(...nums);
    const precioMax = Math.max(...nums);
    const precioPromedio = Number(((precioMin + precioMax) / 2).toFixed(2));
    out.push({
      categoria,
      precio_promedio: precioPromedio,
      precio_max: precioMax,
      precio_min: precioMin,
      unidad: "kg",
      fecha,
    });
  }

  const unicos = new Map();
  for (const item of out) {
    if (!CATEGORIAS_OBJETIVO.includes(item.categoria)) continue;
    if (!unicos.has(item.categoria)) unicos.set(item.categoria, item);
  }

  return Array.from(unicos.values());
};

const obtenerPreciosHacienda = async () => {
  let ultimoError = null;
  for (const url of URLS) {
    try {
      const response = await axios.get(url, {
        timeout: 30_000,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { "User-Agent": "AgroHabilis/1.0" },
      });
      const items = extraerDesdeHtml(response.data);
      if (items.length) return items;
    } catch (error) {
      ultimoError = error;
    }
  }
  if (ultimoError) throw ultimoError;
  return [];
};

module.exports = { obtenerPreciosHacienda };
