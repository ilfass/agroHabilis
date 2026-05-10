const axios = require("axios");
const cheerio = require("cheerio");
const { obtenerMercadosWeb } = require("../scrapers/mercados_web");
const { obtenerNoticiasWeb } = require("../scrapers/noticias_web");

const normalizar = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const CULTIVOS = [
  { key: "soja", aliases: ["soja"] },
  { key: "maiz", aliases: ["maiz", "maiz"] },
  { key: "trigo", aliases: ["trigo"] },
  { key: "girasol", aliases: ["girasol"] },
  { key: "sorgo", aliases: ["sorgo"] },
  { key: "papa", aliases: ["papas", "papa", "patata", "patatas"] },
];

const detectarCultivos = (texto = "") => {
  const t = normalizar(texto);
  return CULTIVOS.filter((c) => c.aliases.some((a) => t.includes(normalizar(a)))).map((c) => c.key);
};

const parseNumber = (txt = "") => {
  const m = String(txt).match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:\.\d+)?)/);
  if (!m) return null;
  let v = m[1].replace(/\s/g, "");
  if (v.includes(",") && v.includes(".")) v = v.replace(/\./g, "").replace(",", ".");
  else if (v.includes(",")) v = v.replace(",", ".");
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const extraerFuturosDesdeTexto = ({ texto = "", fuente = "web", url = null, fecha = null, cultivos = [] }) => {
  const wantedCultivos = cultivos.length ? cultivos : ["soja", "maiz"];
  const out = [];
  const monthMap = [
    { key: "mayo", re: "(?:mayo|may)" },
    { key: "julio", re: "(?:julio|jul)" },
  ];

  for (const cultivo of wantedCultivos) {
    const lines = String(texto)
      .split(/[\n.]/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const month of monthMap) {
      const reMonthThenPrice = new RegExp(`${month.re}[^\\n\\r]{0,90}?(\\d{2,4}(?:[.,]\\d{1,2})?)\\s*(?:usd|u\\$s)`, "gi");
      const rePriceThenMonth = new RegExp(`(\\d{2,4}(?:[.,]\\d{1,2})?)\\s*(?:usd|u\\$s)[^\\n\\r]{0,90}?${month.re}`, "gi");
      for (const line of lines) {
        const ln = normalizar(line);
        if (!ln.includes(cultivo)) continue;
        for (const re of [reMonthThenPrice, rePriceThenMonth]) {
          let m;
          while ((m = re.exec(line)) !== null) {
            const precio = parseNumber(m[1]);
            if (!Number.isFinite(precio) || precio <= 0) continue;
            out.push({
              cultivo,
              posicion: month.key,
              precio_usd: precio,
              fuente,
              url,
              fecha,
            });
          }
        }
      }
    }
  }

  const dedup = new Map();
  for (const r of out) {
    const k = `${r.cultivo}|${r.posicion}|${r.precio_usd}|${String(r.fecha || "").slice(0, 10)}|${r.url || ""}`;
    if (!dedup.has(k)) dedup.set(k, r);
  }
  return Array.from(dedup.values());
};

const extraerFuturosDesdeNoticias = (noticias = [], cultivos = []) => {
  const wantedCultivos = cultivos.length ? cultivos : ["soja", "maiz"];
  const wantedMonths = [
    { key: "mayo", re: /\bmayo\b|\bmay\b/ },
    { key: "julio", re: /\bjulio\b|\bjul\b/ },
  ];
  const out = [];

  for (const n of noticias) {
    const texto = `${n.titulo || ""} ${n.resumen || ""}`;
    const t = normalizar(texto);
    for (const cultivo of wantedCultivos) {
      if (!t.includes(cultivo)) continue;
      for (const mes of wantedMonths) {
        if (!mes.re.test(t)) continue;
        const lines = String(texto).split(/[.\n]/);
        for (const line of lines) {
          const ln = normalizar(line);
          if (!ln.includes(cultivo)) continue;
          if (!mes.re.test(ln)) continue;
          const usdHint = /\busd\b|u\$s|dolar/.test(ln);
          const precio = parseNumber(line);
          if (!Number.isFinite(precio) || precio <= 0 || !usdHint) continue;
          out.push({
            cultivo,
            posicion: mes.key,
            precio_usd: precio,
            fuente: n.fuente || "web",
            url: n.url || null,
            fecha: n.publicado_en || null,
          });
        }
      }
    }
  }

  const dedup = new Map();
  for (const r of out) {
    const k = `${r.cultivo}|${r.posicion}|${r.fuente}|${String(r.fecha || "").slice(0, 10)}`;
    if (!dedup.has(k)) dedup.set(k, r);
  }
  return Array.from(dedup.values()).slice(0, 12);
};

const fetchSafrasFuturos = async (cultivos = []) => {
  const headers = { "User-Agent": "AgroHabilis/1.0 (+web-fallback)" };
  const home = await axios.get("https://safras.com.br/es/", {
    timeout: 20000,
    headers,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const $ = cheerio.load(home.data);
  const links = new Set();

  $("a[href]").each((_, el) => {
    const href = String($(el).attr("href") || "").trim();
    if (!href) return;
    const full = href.startsWith("http") ? href : `https://safras.com.br${href}`;
    const h = normalizar(full);
    if (!h.includes("matba") && !h.includes("rofex")) return;
    if (!h.includes("soja") && !h.includes("maiz")) return;
    links.add(full);
  });

  const selected = Array.from(links).slice(0, 8);
  const futuros = [];
  for (const link of selected) {
    try {
      const page = await axios.get(link, {
        timeout: 20000,
        headers,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const $$ = cheerio.load(page.data);
      const body = $$("main, article, .entry-content, .post-content, body").first().text();
      const fecha =
        $$("meta[property='article:published_time']").attr("content") ||
        $$("time").first().attr("datetime") ||
        null;
      futuros.push(
        ...extraerFuturosDesdeTexto({
          texto: body,
          fuente: "Safras",
          url: link,
          fecha,
          cultivos,
        })
      );
    } catch (_e) {
      // best effort por link
    }
  }
  return futuros;
};

const buscarDatosAgroEnWeb = async ({ pregunta = "", cultivos = [] } = {}) => {
  const objetivos = cultivos.length ? cultivos : detectarCultivos(pregunta);
  const [mercadosRaw, noticiasRaw] = await Promise.all([
    obtenerMercadosWeb().catch(() => ({ items: [], errores: ["mercados_web_error"] })),
    obtenerNoticiasWeb().catch(() => ({ noticias: [], errores: ["noticias_web_error"] })),
  ]);

  const mercados = (mercadosRaw.items || [])
    .filter((x) => !objetivos.length || objetivos.includes(normalizar(x.cultivo)))
    .slice(0, 15)
    .map((x) => ({
      cultivo: normalizar(x.cultivo),
      mercado: x.mercado,
      precio_ars: Number.isFinite(Number(x.precio_ars)) ? Number(x.precio_ars) : null,
      precio_usd: Number.isFinite(Number(x.precio_usd)) ? Number(x.precio_usd) : null,
      fecha: x.fecha || null,
      fuente: x.mercado || "web",
    }));

  const noticias = (noticiasRaw.noticias || []).slice(0, 20);
  const futurosNoticias = extraerFuturosDesdeNoticias(noticias, objetivos);
  const futurosSafras = await fetchSafrasFuturos(objetivos).catch(() => []);
  const futuros = [...futurosSafras, ...futurosNoticias];
  const futDedup = new Map();
  for (const f of futuros) {
    const k = `${f.cultivo}|${f.posicion}|${String(f.fecha || "").slice(0, 10)}|${f.fuente || "web"}`;
    if (!futDedup.has(k)) futDedup.set(k, f);
  }

  return {
    mercados,
    futuros: Array.from(futDedup.values()).slice(0, 20),
    noticias: noticias.slice(0, 6).map((n) => ({
      fuente: n.fuente,
      titulo: n.titulo,
      url: n.url,
      publicado_en: n.publicado_en,
    })),
    errores: [...(mercadosRaw.errores || []), ...(noticiasRaw.errores || [])],
  };
};

module.exports = {
  buscarDatosAgroEnWeb,
};

