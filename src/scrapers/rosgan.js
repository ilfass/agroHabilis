const axios = require("axios");
const cheerio = require("cheerio");

const URLS = [
  "https://www.gananorpujol.com/rosgan/",
  "https://www.rosgan.com.ar/",
];

const UA = { "User-Agent": "AgroHabilis/1.0 (+rosgan)" };

const norm = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const fechaHoyAr = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

const toNum = (txt = "") => {
  const clean = String(txt || "").replace(/[^\d.,-]/g, "").trim();
  if (!clean) return null;
  const n = Number(clean.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const fetchRosganHtml = async (url) => {
  try {
    const res = await axios.get(url, {
      timeout: 30_000,
      headers: UA,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return String(res.data || "");
  } catch (error) {
    const viaJina = await axios.get(`https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`, {
      timeout: 35_000,
      headers: UA,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return String(viaJina.data || "");
  }
};

const mapCategoria = (txt = "") => {
  const t = norm(txt);
  if (t.includes("ternero")) return "ternero";
  if (t.includes("ternera")) return "ternero";
  if (t.includes("terneros/as")) return "ternero";
  if (t.includes("novillo")) return "novillo";
  if (t.includes("novillito")) return "novillo";
  if (t.includes("vaca")) return "vaca";
  if (t.includes("vacas de inv")) return "vaca";
  if (t.includes("vaquillona")) return "vaquillona";
  if (t.includes("invernada")) return "invernada";
  return null;
};

const esFilaNoComparablePorUnidad = (txt = "") => {
  const t = norm(txt);
  return /(cria al pie|garantia de preñez|gtia\.? preñez|vientres|entorados|c\/cria|c\/gtia)/.test(t);
};

const extraerFilas = ($) => {
  const rows = [];
  $("table tr").each((_, tr) => {
    const cols = $(tr)
      .find("th,td")
      .map((__, c) => $(c).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
    if (cols.length >= 2) rows.push(cols);
  });
  return rows;
};

const parsearRosgan = (html = "") => {
  const $ = cheerio.load(String(html || ""));
  const filasTabla = [];
  $("tr").each((_, tr) => {
    const cols = $(tr)
      .find("th,td")
      .map((__, c) => $(c).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
    if (cols.length >= 2) filasTabla.push(cols);
  });
  const filas = extraerFilas($);
  const fecha = fechaHoyAr();
  const buckets = {};

  for (const f of [...filasTabla, ...filas]) {
    const label = String(f[0] || "");
    if (esFilaNoComparablePorUnidad(label)) continue;
    const categoria = mapCategoria(f[0] || "");
    if (!categoria) continue;
    const nums = f.map(toNum).filter(Number.isFinite);
    if (!nums.length) continue;
    const precio = nums[nums.length - 1];
    if (precio > 20000) continue; // Evita mezclar filas en $/cabeza con referencias $/kg.
    if (!buckets[categoria]) buckets[categoria] = [];
    buckets[categoria].push(precio);
  }

  const out = [];
  for (const [categoria, valores] of Object.entries(buckets)) {
    if (!valores.length) continue;
    const orden = [...valores].sort((a, b) => a - b);
    const min = orden[0];
    const max = orden[orden.length - 1];
    const prom = valores.reduce((a, b) => a + b, 0) / valores.length;
    out.push({
      categoria,
      precio_promedio: Number(prom.toFixed(2)),
      precio_min: Number(min.toFixed(2)),
      precio_max: Number(max.toFixed(2)),
      unidad: "kg",
      fecha,
      moneda: "ARS",
      fuente: "rosgan",
    });
  }
  if (out.length) return out;

  const textoPlano = $("body").text().replace(/\s+/g, " ").trim();
  const patrones = [
    { categoria: "ternero", re: /terneros?\$?\s*([\d\.,]+)/gi },
    { categoria: "ternera", re: /terneras?\$?\s*([\d\.,]+)/gi },
    { categoria: "novillo", re: /novillos?\$?\s*([\d\.,]+)/gi },
    { categoria: "novillito", re: /novillitos?\$?\s*([\d\.,]+)/gi },
    { categoria: "vaquillona", re: /vaquillonas?\$?\s*([\d\.,]+)/gi },
    { categoria: "vaca", re: /vacas?\s+de\s+inv\.?\$?\s*([\d\.,]+)/gi },
  ];
  const fromText = [];
  for (const p of patrones) {
    let m;
    while ((m = p.re.exec(textoPlano)) !== null) {
      const v = toNum(m[1]);
      if (!Number.isFinite(v)) continue;
      fromText.push({
        categoria: p.categoria,
        precio_promedio: Number(v.toFixed(2)),
        precio_min: Number(v.toFixed(2)),
        precio_max: Number(v.toFixed(2)),
        unidad: "kg",
        fecha,
        moneda: "ARS",
        fuente: "rosgan",
      });
      break;
    }
  }
  const dedup = new Map();
  for (const it of fromText) {
    if (!dedup.has(it.categoria)) dedup.set(it.categoria, it);
  }
  return Array.from(dedup.values());
};

const calcularTendencia = (actual = [], previo = []) => {
  const prevMap = new Map((previo || []).map((x) => [x.categoria, Number(x.precio_promedio)]));
  return (actual || []).map((item) => {
    const prev = prevMap.get(item.categoria);
    const curr = Number(item.precio_promedio);
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0) {
      return { ...item, variacion_pct: null, tendencia: "estable" };
    }
    const pct = ((curr - prev) / prev) * 100;
    const tendencia = pct > 1 ? "suba" : pct < -1 ? "baja" : "estable";
    return { ...item, variacion_pct: Number(pct.toFixed(2)), tendencia };
  });
};

const obtenerPreciosRosgan = async () => {
  let ultimoError = null;
  let previo = [];

  for (const url of URLS) {
    try {
      const html = await fetchRosganHtml(url);
      const items = parsearRosgan(html);
      if (items.length) {
        return calcularTendencia(items, previo);
      }
      // Mantiene último parse para potencial comparación si siguiente URL trae mejor tabla.
      if (!previo.length) previo = items;
    } catch (error) {
      ultimoError = error;
    }
  }
  if (ultimoError) {
    console.warn("[Rosgan] No se pudo obtener tabla estructurada:", ultimoError.message);
  }
  return [];
};

module.exports = {
  obtenerPreciosRosgan,
};
