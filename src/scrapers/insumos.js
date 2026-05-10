const axios = require("axios");
const cheerio = require("cheerio");
const { normalizarFuenteLabel } = require("../utils/data_quality");

const URLS = [
  { url: "https://www.agrofy.com.ar/insumos", fuente: normalizarFuenteLabel("Agrofy") },
  {
    url: "https://r.jina.ai/http://www.agrofy.com.ar/insumos/productos-con-precio",
    fuente: normalizarFuenteLabel("Agrofy (proxy productos-con-precio)"),
  },
  {
    url: "https://r.jina.ai/http://www.agrofy.com.ar/insumos",
    fuente: normalizarFuenteLabel("Agrofy (proxy)"),
  },
  {
    url: "https://www.agroads.com.ar/insumos-agricolas",
    fuente: normalizarFuenteLabel("Agroads"),
  },
  {
    url: "https://r.jina.ai/http://www.agroads.com.ar/insumos-agricolas",
    fuente: normalizarFuenteLabel("Agroads (proxy)"),
  },
];
const ML_SEARCH = "https://api.mercadolibre.com/sites/MLA/search";

const normalizar = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const parseNumero = (txt = "") => {
  const money = String(txt).match(/(?:U?\$)\s*([\d\.\,]+)/i);
  const m = money || String(txt).match(/(\d[\d\.\,]*)/);
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
  return "general";
};

const extraerDesdeHtml = (html, fuente) => {
  const esProductoValido = (s = "") => {
    const t = String(s || "");
    if (!t) return false;
    if (/[<>{}]/.test(t)) return false;
    if (/__next_data__|script|function|var\s|const\s|class=/i.test(t)) return false;
    if (t.length < 12) return false;
    return /[a-zA-Záéíóúñ]/i.test(t);
  };

  const $ = cheerio.load(html);
  const fecha = new Date().toISOString().slice(0, 10);
  const candidatos = [];

  $("article, .product-item, .item-box, li, div").each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (!txt || txt.length < 20) return;
    if (!/\$/.test(txt)) return;
    const precio = parseNumero(txt);
    if (!Number.isFinite(precio)) return;
    const categoria = detectarCategoria(txt);
    const producto = txt.slice(0, 90);
    if (!esProductoValido(producto)) return;
    candidatos.push({
      categoria,
      producto,
      precio,
      unidad: "unidad",
      moneda: "ARS",
      fuente,
      fecha,
    });
  });

  const unicos = new Map();
  for (const c of candidatos) {
    const key = `${c.producto.toLowerCase()}_${c.fecha}`;
    if (!unicos.has(key)) unicos.set(key, c);
  }
  const htmlItems = Array.from(unicos.values()).slice(0, 30);
  if (htmlItems.length) return htmlItems;

  const mdItems = [];
  const mdRegex = /(?:\]\([^)]+\)\s*)([^$\n]{8,140}?)(U?\$)\s*([\d\.\,]+)/gim;
  let match;
  while ((match = mdRegex.exec(String(html))) !== null) {
    const producto = String(match[1] || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90);
    if (!esProductoValido(producto)) continue;
    const precio = parseNumero(`${match[2]}${match[3]}`);
    if (!Number.isFinite(precio) || precio <= 0) continue;
    mdItems.push({
      categoria: detectarCategoria(producto),
      producto,
      precio,
      unidad: "unidad",
      moneda: /U\$/i.test(match[2]) ? "USD" : "ARS",
      fuente,
      fecha,
    });
  }
  if (mdItems.length) {
    const unicosMd = new Map();
    for (const c of mdItems) {
      const key = `${c.producto.toLowerCase()}_${c.fecha}`;
      if (!unicosMd.has(key)) unicosMd.set(key, c);
    }
    return Array.from(unicosMd.values()).slice(0, 30);
  }

  // Fallback para respuestas tipo markdown/texto plano (ej: proxy jina.ai).
  const lineas = String(html)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const txtItems = [];
  for (const linea of lineas) {
    if (!/(\$|U\$)/.test(linea)) continue;
    const precio = parseNumero(linea);
    if (!Number.isFinite(precio) || precio <= 0) continue;
    const categoria = detectarCategoria(linea);
    const limpio = linea
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const producto = limpio.slice(0, 90);
    if (!esProductoValido(producto)) continue;
    txtItems.push({
      categoria,
      producto,
      precio,
      unidad: "unidad",
      moneda: /U\$/i.test(linea) ? "USD" : "ARS",
      fuente,
      fecha,
    });
  }
  const unicosTxt = new Map();
  for (const c of txtItems) {
    const key = `${c.producto.toLowerCase()}_${c.fecha}`;
    if (!unicosTxt.has(key)) unicosTxt.set(key, c);
  }
  return Array.from(unicosTxt.values()).slice(0, 30);
};

const obtenerPreciosInsumos = async () => {
  let ultimoError = null;
  for (const src of URLS) {
    try {
      const response = await axios.get(src.url, {
        timeout: 30_000,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { "User-Agent": "AgroHabilis/1.0" },
      });
      const items = extraerDesdeHtml(response.data, src.fuente);
      if (items.length) return items;
    } catch (error) {
      ultimoError = error;
    }
  }
  // Fallback API pública: MercadoLibre (sin auth) para referencias de mercado.
  try {
    const fecha = new Date().toISOString().slice(0, 10);
    const queries = [
      { q: "glifosato", categoria: "agroquimico" },
      { q: "urea fertilizante", categoria: "fertilizante" },
      { q: "semilla soja", categoria: "semilla" },
    ];
    const out = [];
    for (const item of queries) {
      const response = await axios.get(ML_SEARCH, {
        timeout: 20_000,
        params: { q: item.q, limit: 10 },
        validateStatus: (s) => s === 200,
        headers: { "User-Agent": "AgroHabilis/1.0" },
      });
      const results = Array.isArray(response.data?.results) ? response.data.results : [];
      for (const r of results) {
        const precio = Number(r?.price);
        if (!Number.isFinite(precio) || precio <= 0) continue;
        const titulo = String(r?.title || "").trim();
        if (!titulo) continue;
        out.push({
          categoria: item.categoria,
          producto: titulo.slice(0, 90),
          precio,
          unidad: "unidad",
          moneda: "ARS",
          fuente: normalizarFuenteLabel("MercadoLibre"),
          fecha,
        });
      }
    }
    const unicos = new Map();
    for (const c of out) {
      const key = `${c.producto.toLowerCase()}_${c.fecha}`;
      if (!unicos.has(key)) unicos.set(key, c);
    }
    const items = Array.from(unicos.values()).slice(0, 30);
    if (items.length) return items;
  } catch (error) {
    ultimoError = error;
  }
  if (ultimoError) throw ultimoError;
  return [];
};

module.exports = { obtenerPreciosInsumos };
