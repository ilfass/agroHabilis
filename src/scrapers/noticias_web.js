const axios = require("axios");
const cheerio = require("cheerio");

const HEADERS = { "User-Agent": "AgroHabilis/1.0 (+noticias-web)" };

const normalizarTexto = (s = "") => String(s).replace(/\s+/g, " ").trim();

const recortar = (s = "", n = 280) => {
  const t = normalizarTexto(s);
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const parseFecha = (v) => {
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return new Date().toISOString();
};

const fetchWpPosts = async ({ baseUrl, fuente, categoria }) => {
  const url = `${baseUrl.replace(/\/$/, "")}/wp-json/wp/v2/posts`;
  const response = await axios.get(url, {
    timeout: 20_000,
    headers: HEADERS,
    params: {
      per_page: 12,
      _fields: "id,date,link,title,excerpt",
      orderby: "date",
      order: "desc",
    },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const posts = Array.isArray(response.data) ? response.data : [];
  return posts
    .map((p) => {
      const titulo = recortar(p?.title?.rendered || "", 180);
      const resumenHtml = String(p?.excerpt?.rendered || "");
      const resumen = recortar(
        resumenHtml.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " "),
        320
      );
      const link = String(p?.link || "").trim();
      if (!titulo || !link) return null;
      return {
        fuente,
        categoria,
        titulo,
        url: link,
        resumen,
        publicado_en: parseFecha(p?.date),
        tipo: "noticia",
      };
    })
    .filter(Boolean);
};

const fetchTodoagro = async () => {
  const response = await axios.get("https://www.todoagro.com.ar", {
    timeout: 20_000,
    headers: HEADERS,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const $ = cheerio.load(response.data);
  const out = [];
  $("article, .td-module-container, .post, .jeg_post").each((_, el) => {
    const a = $(el).find("a[href]").first();
    const href = String(a.attr("href") || "").trim();
    const titulo = recortar(a.text(), 180);
    const resumen = recortar($(el).text(), 320);
    if (!href || !titulo) return;
    if (!/^https?:\/\//i.test(href)) return;
    out.push({
      fuente: "TodoAgro",
      categoria: "agro_general",
      titulo,
      url: href,
      resumen,
      publicado_en: new Date().toISOString(),
      tipo: "noticia",
    });
  });
  const dedup = new Map();
  for (const it of out) {
    const key = `${it.fuente}|${it.url}`;
    if (!dedup.has(key)) dedup.set(key, it);
  }
  return Array.from(dedup.values()).slice(0, 12);
};

const fetchLanacionCampo = async () => {
  const out = [];
  const directUrl = "https://www.lanacion.com.ar/economia/campo/";
  try {
    const response = await axios.get(directUrl, {
      timeout: 25_000,
      headers: HEADERS,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const $ = cheerio.load(response.data);
    $("article, .mod-article, .story, .com-article, a[href*='/campo/']").each((_, el) => {
      const a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
      const href = String(a.attr("href") || "").trim();
      const titulo = recortar(a.text(), 180);
      const resumen = recortar($(el).text(), 320);
      if (!href || !titulo) return;
      const url = href.startsWith("http") ? href : `https://www.lanacion.com.ar${href}`;
      out.push({
        fuente: "La Nación Campo",
        categoria: "agro_general",
        titulo,
        url,
        resumen,
        publicado_en: new Date().toISOString(),
        tipo: "noticia",
      });
    });
  } catch (_error) {
    // fallback a jina para páginas muy dinámicas
  }

  if (!out.length) {
    const jina = await axios.get("https://r.jina.ai/http://www.lanacion.com.ar/economia/campo/", {
      timeout: 25_000,
      headers: HEADERS,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const lines = String(jina.data || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith("## ")) continue;
      const titulo = recortar(line.replace(/^##\s+/, ""), 180);
      if (!titulo || titulo.length < 20) continue;
      out.push({
        fuente: "La Nación Campo",
        categoria: "agro_general",
        titulo,
        url: directUrl,
        resumen: "Nota detectada desde portada de La Nación Campo.",
        publicado_en: new Date().toISOString(),
        tipo: "noticia",
      });
    }
  }

  const dedup = new Map();
  for (const it of out) {
    const key = `${it.fuente}|${it.url}`;
    if (!dedup.has(key)) dedup.set(key, it);
  }
  return Array.from(dedup.values()).slice(0, 12);
};

const fetchGenericPortal = async ({ url, fuente, categoria = "agro_general", limit = 12 }) => {
  const response = await axios.get(url, {
    timeout: 25_000,
    headers: HEADERS,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const $ = cheerio.load(response.data);
  const out = [];
  $("article, .post, .entry, .news-item, .td-module-container, a[href]").each((_, el) => {
    const node = $(el);
    const a = node.is("a") ? node : node.find("a[href]").first();
    const href = String(a.attr("href") || "").trim();
    if (!href) return;
    const titulo = recortar(a.text() || node.find("h1,h2,h3").first().text(), 180);
    if (!titulo || titulo.length < 18) return;
    const urlFinal = /^https?:\/\//i.test(href) ? href : new URL(href, url).toString();
    const resumen = recortar(node.text(), 520);
    out.push({
      fuente,
      categoria,
      titulo,
      url: urlFinal,
      resumen,
      publicado_en: new Date().toISOString(),
      tipo: "noticia",
    });
  });
  const dedup = new Map();
  for (const it of out) {
    const key = `${it.fuente}|${it.url}`;
    if (!dedup.has(key)) dedup.set(key, it);
  }
  return Array.from(dedup.values()).slice(0, limit);
};

const obtenerNoticiasWeb = async () => {
  const errores = [];
  const advertencias = [];
  const noticias = [];

  try {
    const items = await fetchWpPosts({
      baseUrl: "https://www.noticiasdecampo.com",
      fuente: "Noticias de Campo",
      categoria: "agro_general",
    });
    noticias.push(...items);
  } catch (error) {
    errores.push(`noticiasdecampo: ${error.message}`);
  }

  try {
    const items = await fetchWpPosts({
      baseUrl: "https://www.infocampo.com.ar",
      fuente: "InfoCampo",
      categoria: "agro_general",
    });
    noticias.push(...items);
  } catch (error) {
    errores.push(`infocampo: ${error.message}`);
  }

  try {
    const items = await fetchTodoagro();
    noticias.push(...items);
  } catch (error) {
    errores.push(`todoagro: ${error.message}`);
  }

  try {
    const items = await fetchLanacionCampo();
    noticias.push(...items);
  } catch (error) {
    // La Nación es fuente complementaria: si falla no debe romper la salud del pipeline.
    advertencias.push(`lanacion_campo: ${error.message}`);
  }

  try {
    const items = await fetchGenericPortal({
      url: "https://www.revistachacra.com.ar/",
      fuente: "Revista Chacra",
      categoria: "agro_general",
    });
    noticias.push(...items);
  } catch (error) {
    advertencias.push(`revista_chacra: ${error.message}`);
  }

  try {
    const items = await fetchGenericPortal({
      url: "https://www.expoagro.com.ar/mercados-futuros/",
      fuente: "Expoagro Mercados",
      categoria: "futuros",
    });
    noticias.push(...items);
  } catch (error) {
    advertencias.push(`expoagro_mercados_futuros: ${error.message}`);
  }

  try {
    const items = await fetchGenericPortal({
      url: "https://www.expoagro.com.ar/futuros-y-opciones/",
      fuente: "Expoagro Futuros y Opciones",
      categoria: "futuros_opciones",
    });
    noticias.push(...items);
  } catch (error) {
    advertencias.push(`expoagro_futuros_opciones: ${error.message}`);
  }

  try {
    const items = await fetchGenericPortal({
      url: "https://campoparatodos.com.ar/tag/revista/",
      fuente: "Campo para Todos",
      categoria: "agro_regional",
    });
    noticias.push(...items);
  } catch (error) {
    advertencias.push(`campo_para_todos: ${error.message}`);
  }

  try {
    const items = await fetchGenericPortal({
      url: "https://ojs.suelos.org.ar/index.php/cds",
      fuente: "Ciencia del Suelo",
      categoria: "suelos_nutricion",
    });
    noticias.push(...items);
  } catch (error) {
    advertencias.push(`ciencia_del_suelo: ${error.message}`);
  }

  const dedup = new Map();
  for (const n of noticias) {
    const key = `${n.fuente}|${n.url}`;
    if (!dedup.has(key)) dedup.set(key, n);
  }

  return { noticias: Array.from(dedup.values()).slice(0, 30), errores, advertencias };
};

module.exports = {
  obtenerNoticiasWeb,
};
