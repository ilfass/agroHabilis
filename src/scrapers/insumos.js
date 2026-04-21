const axios = require("axios");
const cheerio = require("cheerio");

const URL = "https://www.agrofy.com.ar/insumos";

const normalizar = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const parseNumero = (txt = "") => {
  const m = String(txt).match(/(\d[\d\.\,]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const detectarCategoria = (producto = "") => {
  const p = normalizar(producto);
  if (p.includes("glifosato") || p.includes("herbicida") || p.includes("fungicida")) {
    return "agroquimico";
  }
  if (p.includes("urea") || p.includes("fosfato") || p.includes("fertiliz")) {
    return "fertilizante";
  }
  if (p.includes("semilla")) return "semilla";
  return null;
};

const obtenerPreciosInsumos = async () => {
  const response = await axios.get(URL, {
    timeout: 30_000,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: { "User-Agent": "AgroHabilis/1.0" },
  });
  const $ = cheerio.load(response.data);
  const fecha = new Date().toISOString().slice(0, 10);
  const candidatos = [];

  $("article, .product-item, .item-box, li, div").each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (!txt || txt.length < 20) return;
    if (!/\$/.test(txt)) return;
    const precio = parseNumero(txt);
    if (!Number.isFinite(precio)) return;
    const categoria = detectarCategoria(txt);
    if (!categoria) return;
    const producto = txt.slice(0, 90);
    candidatos.push({
      categoria,
      producto,
      precio,
      unidad: "unidad",
      moneda: "ARS",
      fuente: "Agrofy",
      fecha,
    });
  });

  const unicos = new Map();
  for (const c of candidatos) {
    const key = `${c.producto.toLowerCase()}_${c.fecha}`;
    if (!unicos.has(key)) unicos.set(key, c);
  }
  return Array.from(unicos.values()).slice(0, 30);
};

module.exports = { obtenerPreciosInsumos };
