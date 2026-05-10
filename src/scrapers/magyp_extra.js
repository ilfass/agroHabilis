const axios = require("axios");
const cheerio = require("cheerio");

const UA = { "User-Agent": "AgroHabilis/1.0 (+magyp-extra)" };

const normalizar = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const toNum = (v) => {
  if (v === null || v === undefined) return null;
  const raw = String(v).replace(/[^\d,.-]/g, "").trim();
  if (!raw) return null;
  // miles con punto, decimal con coma
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const fechaHoyAr = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

const fetchText = async (url) => {
  const direct = await axios.get(url, {
    timeout: 25_000,
    headers: UA,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const html = String(direct.data || "");
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  if (text.length > 1200) return text;

  // fallback para páginas altamente dinámicas
  const viaJina = await axios.get(`https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`, {
    timeout: 25_000,
    headers: UA,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return String(viaJina.data || "").replace(/\s+/g, " ").trim();
};

const fetchHtml = async (url) => {
  const direct = await axios.get(url, {
    timeout: 25_000,
    headers: UA,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return String(direct.data || "");
};

const MAP_CULTIVO = {
  trigo: "trigo",
  maiz: "maiz",
  soja: "soja",
  poroto: "soja",
  girasol: "girasol",
  sorgo: "sorgo",
  "cebada cervecera": "cebada",
  "cebada forrajera": "cebada",
  harina: "soja_harina",
  aceite: "soja_aceite",
};

const obtenerMercadosAgropecuariosMagyp = async () => {
  const url = "https://www.magyp.gob.ar/mercadosagropecuarios/";
  const txt = normalizar(await fetchText(url));
  const fecha = fechaHoyAr();
  const items = [];

  const re =
    /(trigo|maiz|girasol|soja|sorgo|cebada cervecera|cebada forrajera)\s+fob:\s*([\d\.,]+)\s*usd\/t\s*:\s*([\d\.,]+)\s*\$\/t/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const cultivoRaw = m[1];
    const cultivo = MAP_CULTIVO[cultivoRaw] || cultivoRaw;
    const fobUsd = toNum(m[2]);
    const fasArs = toNum(m[3]);
    if (Number.isFinite(fobUsd)) {
      items.push({
        cultivo,
        mercado: "MAGYP_MERCADOS_FOB",
        precio_usd: fobUsd,
        precio_ars: null,
        fecha,
      });
    }
    if (Number.isFinite(fasArs)) {
      items.push({
        cultivo,
        mercado: "MAGYP_MERCADOS_FAS",
        precio_ars: fasArs,
        precio_usd: null,
        fecha,
      });
    }
  }

  // Fallback: si la página no expone nombres en texto, usa orden fijo visual.
  if (!items.length) {
    const cultivosOrden = ["trigo", "maiz", "girasol", "soja", "sorgo", "cebada", "cebada"];
    const fobMatches = [...txt.matchAll(/fob:\s*([\d\.,]+)\s*usd\/t/g)].map((x) => toNum(x[1]));
    const fasMatches = [...txt.matchAll(/:\s*([\d\.,]+)\s*\$\/t/g)].map((x) => toNum(x[1]));
    for (let i = 0; i < Math.min(cultivosOrden.length, fobMatches.length, fasMatches.length); i += 1) {
      const cultivo = cultivosOrden[i];
      const fobUsd = fobMatches[i];
      const fasArs = fasMatches[i];
      if (Number.isFinite(fobUsd)) {
        items.push({
          cultivo,
          mercado: "MAGYP_MERCADOS_FOB",
          precio_usd: fobUsd,
          precio_ars: null,
          fecha,
        });
      }
      if (Number.isFinite(fasArs)) {
        items.push({
          cultivo,
          mercado: "MAGYP_MERCADOS_FAS",
          precio_ars: fasArs,
          precio_usd: null,
          fecha,
        });
      }
    }
  }
  return items;
};

const obtenerSioGranosMonitor = async () => {
  const url = "https://monitorssma.magyp.gob.ar/siogranos.dashboardgranos.aspx";
  const txt = await fetchText(url);
  const fecha = fechaHoyAr();
  const items = [];

  const reArs = /Value Card1\s*[A-Z]*\s*\$([\d\.,]+)\s*(Poroto|Cervecera|Forrajera|Aceite|Harina)/gi;
  let mArs;
  while ((mArs = reArs.exec(txt)) !== null) {
    const producto = normalizar(mArs[2]).trim();
    const cultivo = MAP_CULTIVO[producto];
    const ars = toNum(mArs[1]);
    if (!cultivo || !Number.isFinite(ars)) continue;
    items.push({
      cultivo,
      mercado: "SIOGRANOS_MONITOR_FAS",
      precio_ars: ars,
      precio_usd: null,
      fecha,
    });
  }

  const reUsd = /Value Card2\s*[A-Z]*\s*U\$S\s*([\d\.,]+)\s*(Poroto|Cervecera|Forrajera|Aceite|Harina)/gi;
  let mUsd;
  while ((mUsd = reUsd.exec(txt)) !== null) {
    const producto = normalizar(mUsd[2]).trim();
    const cultivo = MAP_CULTIVO[producto];
    const usd = toNum(mUsd[1]);
    if (!cultivo || !Number.isFinite(usd)) continue;
    items.push({
      cultivo,
      mercado: "SIOGRANOS_MONITOR_FOB",
      precio_ars: null,
      precio_usd: usd,
      fecha,
    });
  }

  return items;
};

const obtenerSioCarnesPorcino = async () => {
  const url = "https://siocarnes.magyp.gob.ar/MonitorSioCarnes/MonitorSioCarnes?idAnimal=2&animal=PORCINO#";
  const txt = normalizar(await fetchText(url));
  const fecha = fechaHoyAr();

  const promedio = txt.match(/precio promedio del dia\s*([\d\.,]+)/i)?.[1];
  const minimo = txt.match(/precio minimo del dia\s*([\d\.,]+)/i)?.[1];
  const maximo = txt.match(/precio maximo del dia\s*([\d\.,]+)/i)?.[1];

  const p = toNum(promedio);
  const pMin = toNum(minimo);
  const pMax = toNum(maximo);
  if (!Number.isFinite(p) && !Number.isFinite(pMin) && !Number.isFinite(pMax)) return [];

  return [
    {
      categoria: "porcino_referencia",
      precio_promedio: Number.isFinite(p) ? p : null,
      precio_min: Number.isFinite(pMin) ? pMin : null,
      precio_max: Number.isFinite(pMax) ? pMax : null,
      unidad: "kg_vivo",
      fecha,
    },
  ];
};

const obtenerNoticiasMagypExtra = async () => {
  const fecha = new Date().toISOString();
  const out = [];

  const monitorUrl = "https://www.magyp.gob.ar/sitio/areas/estimaciones/monitor/";
  try {
    const txt = await fetchText(monitorUrl);
    const resumen = txt.slice(0, 520);
    out.push({
      fuente: "MAGYP Estimaciones",
      categoria: "estimaciones_agricolas",
      titulo: "Monitor de Estimaciones Agrícolas (MAGyP)",
      url: monitorUrl,
      resumen,
      publicado_en: fecha,
      tipo: "noticia",
    });
  } catch (_e) {}

  const mielUrl = "https://www.magyp.gob.ar/monitorpreciosmiel/";
  try {
    const txt = await fetchText(mielUrl);
    const resumen = txt.slice(0, 520);
    out.push({
      fuente: "MAGYP SIM Miel",
      categoria: "economias_regionales",
      titulo: "Monitor SIM - Precio de referencia semanal de miel",
      url: mielUrl,
      resumen,
      publicado_en: fecha,
      tipo: "noticia",
    });
  } catch (_e) {}

  const avanceSemanalUrl =
    "https://www.magyp.gob.ar/sitio/areas/estimaciones/monitor_semanal/avance/index.php";
  try {
    const txtAvanceRaw = await fetchText(avanceSemanalUrl);
    const txtAvance = txtAvanceRaw.replace(/\s+/g, " ").trim();
    const seleccionCultivos = [
      { key: "soja", re: /\bsoja\b/i, label: "Soja" },
      { key: "maiz", re: /\bma[ií]z\b/i, label: "Maíz" },
      { key: "trigo", re: /\btrigo\b/i, label: "Trigo" },
      { key: "girasol", re: /\bgirasol\b/i, label: "Girasol" },
      { key: "cebada", re: /\bcebada\b/i, label: "Cebada" },
      { key: "sorgo", re: /\bsorgo\b/i, label: "Sorgo" },
    ];

    for (const cultivo of seleccionCultivos) {
      const match = txtAvance.match(cultivo.re);
      const idx = match?.index ?? -1;
      if (idx < 0) continue;
      const inicio = Math.max(0, idx - 110);
      const fin = Math.min(txtAvance.length, idx + 240);
      const resumen = txtAvance.slice(inicio, fin).trim();
      if (resumen.length < 30) continue;
      out.push({
        fuente: "MAGYP Monitor Semanal",
        categoria: "estimaciones_avance_semanal",
        titulo: `Avance semanal ${cultivo.label} (MAGyP)`,
        url: avanceSemanalUrl,
        resumen,
        publicado_en: fecha,
        tipo: "informe",
      });
    }
  } catch (_e) {}

  const informesUrl = "https://www.magyp.gob.ar/sitio/areas/estimaciones/estimaciones/informes/";
  try {
    const html = await fetchHtml(informesUrl);
    const $ = cheerio.load(html);
    const mensuales = [];
    $("a").each((_, el) => {
      const a = $(el);
      const titulo = a.text().replace(/\s+/g, " ").trim();
      if (!/informe mensual/i.test(titulo)) return;
      const href = a.attr("href");
      const url = href ? new URL(href, informesUrl).toString() : informesUrl;
      mensuales.push({ titulo, url });
    });
    const unicos = [];
    const seen = new Set();
    for (const it of mensuales) {
      const key = `${it.titulo}|${it.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unicos.push(it);
      if (unicos.length >= 3) break;
    }
    for (const it of unicos) {
      out.push({
        fuente: "MAGYP Estimaciones",
        categoria: "estimaciones_mensuales",
        titulo: it.titulo,
        url: it.url,
        resumen: `Publicación oficial de estimaciones agrícolas mensuales de MAGyP. Referencia: ${it.titulo}.`,
        publicado_en: fecha,
        tipo: "informe",
      });
    }
  } catch (_e) {}

  return out;
};

const obtenerMagypExtra = async () => {
  const errores = [];
  const precios = [];
  const hacienda = [];
  const noticias = [];

  try {
    precios.push(...(await obtenerMercadosAgropecuariosMagyp()));
  } catch (e) {
    errores.push(`mercadosagropecuarios: ${e.message}`);
  }
  try {
    precios.push(...(await obtenerSioGranosMonitor()));
  } catch (e) {
    errores.push(`siogranos_monitor: ${e.message}`);
  }
  try {
    hacienda.push(...(await obtenerSioCarnesPorcino()));
  } catch (e) {
    errores.push(`siocarnes_porcino: ${e.message}`);
  }
  try {
    noticias.push(...(await obtenerNoticiasMagypExtra()));
  } catch (e) {
    errores.push(`noticias_magyp_extra: ${e.message}`);
  }

  return { precios, hacienda, noticias, errores };
};

module.exports = {
  obtenerMagypExtra,
};

