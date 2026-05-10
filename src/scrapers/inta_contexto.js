const axios = require("axios");
const cheerio = require("cheerio");

const HEADERS = { "User-Agent": "AgroHabilis/1.0 (+inta-contexto)" };
const URLS = [
  "https://www.inta.gob.ar",
  "https://www.argentina.gob.ar/inta",
];

const recortar = (s = "", n = 320) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const esTemaPapa = (txt = "") => {
  const t = String(txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /(papa|spunta|hortic|mercado central|tuberculo|tuberculo)/.test(t);
};

const parseInTaPage = (html = "", baseUrl = "") => {
  const $ = cheerio.load(html);
  const out = [];
  $("a[href]").each((_, el) => {
    const href = String($(el).attr("href") || "").trim();
    const titulo = recortar($(el).text(), 180);
    if (!href || !titulo || titulo.length < 18) return;
    const url = /^https?:\/\//i.test(href) ? href : new URL(href, baseUrl).toString();
    const around = recortar($(el).closest("article,div,li,section").text(), 420);
    if (!esTemaPapa(`${titulo} ${around}`)) return;
    out.push({
      fuente: "INTA",
      categoria: "horticola_contexto",
      titulo,
      url,
      resumen: around || "Contenido técnico detectado en INTA vinculado a papa/horticultura.",
      publicado_en: new Date().toISOString(),
      tipo: "contexto_tecnico",
    });
  });
  const dedup = new Map();
  for (const it of out) {
    const k = `${it.fuente}|${it.url}`;
    if (!dedup.has(k)) dedup.set(k, it);
  }
  return Array.from(dedup.values()).slice(0, 12);
};

const obtenerContextoInta = async () => {
  const errores = [];
  const noticias = [];
  for (const url of URLS) {
    try {
      const r = await axios.get(url, {
        timeout: 20_000,
        headers: HEADERS,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      noticias.push(...parseInTaPage(String(r.data || ""), url));
    } catch (error) {
      errores.push(`${url}: ${error.message}`);
    }
  }
  const dedup = new Map();
  for (const n of noticias) {
    const key = `${n.fuente}|${n.url}`;
    if (!dedup.has(key)) dedup.set(key, n);
  }
  return { noticias: Array.from(dedup.values()).slice(0, 20), errores };
};

module.exports = {
  obtenerContextoInta,
};
