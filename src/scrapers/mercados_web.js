const axios = require("axios");
const cheerio = require("cheerio");

const HEADERS = { "User-Agent": "AgroHabilis/1.0 (+mercados-web)" };

const CULTIVOS = [
  { key: "soja", aliases: ["soja"] },
  { key: "maiz", aliases: ["maiz", "maíz"] },
  { key: "trigo", aliases: ["trigo"] },
  { key: "girasol", aliases: ["girasol"] },
  { key: "sorgo", aliases: ["sorgo"] },
  { key: "papa", aliases: ["papas", "papa", "patata", "patatas"] },
];

const normalizar = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const detectarCultivo = (txt = "") => {
  const t = normalizar(txt);
  for (const c of CULTIVOS) {
    if (c.aliases.some((a) => t.includes(normalizar(a)))) return c.key;
  }
  return null;
};

const parseNumero = (txt = "") => {
  const m = String(txt).match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:\.\d+)?)/);
  if (!m) return null;
  const raw = m[1];
  let normalized = raw.replace(/\s/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const fechaHoyAr = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

const extraerDesdeHtml = ({ html, mercado }) => {
  const $ = cheerio.load(html);
  const lines = [];

  $("table tr, article, .post, .content, .entry-content p, li").each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (txt) lines.push(txt);
  });

  const out = [];
  const fecha = fechaHoyAr();

  for (const line of lines) {
    const cultivo = detectarCultivo(line);
    if (!cultivo) continue;
    const precio = parseNumero(line);
    if (!Number.isFinite(precio) || precio <= 0) continue;
    const isUsd = /\bu\$s\b|usd|dolar/i.test(line);
    out.push({
      cultivo,
      mercado,
      precio_ars: isUsd ? null : precio,
      precio_usd: isUsd ? precio : null,
      fecha,
    });
  }

  const dedup = new Map();
  for (const r of out) {
    const key = `${r.cultivo}|${r.mercado}|${r.fecha}`;
    if (!dedup.has(key)) dedup.set(key, r);
  }
  return Array.from(dedup.values());
};

const extraerTodoagroMercados = (html = "") => {
  const $ = cheerio.load(html);
  const fecha = fechaHoyAr();
  const out = [];
  $("table.tabla-de-mercado tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 4) return;
    const producto = $(tds[0]).text().replace(/\s+/g, " ").trim();
    const mercado = $(tds[1]).text().replace(/\s+/g, " ").trim();
    const precioTxt = $(tds[3]).text().replace(/\s+/g, " ").trim();
    const cultivo = detectarCultivo(producto);
    const precio = parseNumero(precioTxt);
    if (!cultivo || !Number.isFinite(precio) || precio <= 0) return;
    out.push({
      cultivo,
      mercado: `TODOAGRO_WEB_${mercado || "ROS"}`,
      precio_ars: precio,
      precio_usd: null,
      fecha,
    });
  });
  return out;
};

const extraerInfocampoMercados = (html = "") => {
  const $ = cheerio.load(html);
  const fecha = fechaHoyAr();
  const out = [];
  $(".MercadosClimaHome .bloquesMC").each((_, el) => {
    const label = $(el).find("label").text().replace(/\s+/g, " ").trim();
    const value = $(el).find("span").first().text().replace(/\s+/g, " ").trim();
    const cultivo = detectarCultivo(label);
    const precio = parseNumero(value);
    if (!cultivo || !Number.isFinite(precio) || precio <= 0) return;
    out.push({
      cultivo,
      mercado: "INFOCAMPO_WEB",
      precio_ars: precio,
      precio_usd: null,
      fecha,
    });
  });
  return out;
};

const obtenerMercadosWeb = async () => {
  const errores = [];
  const items = [];

  const lncampoUrls = [
    "https://www.lncampo.lanacion.com.ar/mercado-granos/",
    "https://r.jina.ai/http://www.lncampo.lanacion.com.ar/mercado-granos/",
  ];
  let lncampoOk = false;
  for (const url of lncampoUrls) {
    try {
      const lncampo = await axios.get(url, {
        timeout: 30_000,
        headers: HEADERS,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const parsed = extraerDesdeHtml({
        html: lncampo.data,
        mercado: url.includes("r.jina.ai") ? "LNCAMPO_WEB_PROXY" : "LNCAMPO_WEB",
      });
      if (parsed.length) {
        items.push(...parsed);
        lncampoOk = true;
        break;
      }
    } catch (error) {
      errores.push(`lncampo (${url.includes("r.jina.ai") ? "proxy" : "directo"}): ${error.message}`);
    }
  }
  if (!lncampoOk) {
    errores.push("lncampo: sin datos parseables en acceso directo/proxy");
  }

  try {
    const todoagro = await axios.get("https://www.todoagro.com.ar/mercados/", {
      timeout: 30_000,
      headers: HEADERS,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const parsedTabla = extraerTodoagroMercados(todoagro.data);
    if (parsedTabla.length) {
      items.push(...parsedTabla);
    } else {
      items.push(
        ...extraerDesdeHtml({
          html: todoagro.data,
          mercado: "TODOAGRO_WEB",
        })
      );
    }
  } catch (error) {
    errores.push(`todoagro: ${error.message}`);
  }

  try {
    const infocampo = await axios.get("https://www.infocampo.com.ar/category/mercados-y-empresas/", {
      timeout: 30_000,
      headers: HEADERS,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const parsedInfoCampo = extraerInfocampoMercados(infocampo.data);
    if (parsedInfoCampo.length) {
      items.push(...parsedInfoCampo);
    } else {
      items.push(
        ...extraerDesdeHtml({
          html: infocampo.data,
          mercado: "INFOCAMPO_WEB",
        })
      );
    }
  } catch (error) {
    errores.push(`infocampo_mercados: ${error.message}`);
  }

  return { items, errores };
};

module.exports = {
  obtenerMercadosWeb,
};
