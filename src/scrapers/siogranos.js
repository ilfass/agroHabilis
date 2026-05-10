const axios = require("axios");
const cheerio = require("cheerio");

const UA = { "User-Agent": "AgroHabilis/1.0 (+siogranos)" };

const normalizar = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const toNum = (v) => {
  const raw = String(v || "").replace(/[^\d,.-]/g, "").trim();
  if (!raw) return null;
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
  const viaJina = await axios.get(`https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`, {
    timeout: 25_000,
    headers: UA,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return String(viaJina.data || "").replace(/\s+/g, " ").trim();
};

const CULTIVO_MAP = {
  poroto: "soja",
  soja: "soja",
  maiz: "maiz",
  trigo: "trigo",
  girasol: "girasol",
  sorgo: "sorgo",
  "cebada forrajera": "cebada",
  "cebada cervecera": "cebada",
};

const parseMonitorComercioGranario = (txt = "") => {
  const out = [];
  const fecha = fechaHoyAr();

  const reArs = /Value Card1\s*[A-Z]*\s*\$([\d\.,]+)\s*(Poroto|Cervecera|Forrajera|Aceite|Harina)/gi;
  let mArs;
  while ((mArs = reArs.exec(txt)) !== null) {
    const producto = normalizar(mArs[2]);
    const cultivo = CULTIVO_MAP[producto];
    const ars = toNum(mArs[1]);
    if (!cultivo || !Number.isFinite(ars)) continue;
    out.push({
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
    const producto = normalizar(mUsd[2]);
    const cultivo = CULTIVO_MAP[producto];
    const usd = toNum(mUsd[1]);
    if (!cultivo || !Number.isFinite(usd)) continue;
    out.push({
      cultivo,
      mercado: "SIOGRANOS_MONITOR_FOB",
      precio_ars: null,
      precio_usd: usd,
      fecha,
    });
  }
  return out;
};

const obtenerSioGranosAutomatico = async () => {
  const errores = [];
  const advertencias = [];

  // 1) Intento preferido: monitor siogranos (interactivo)
  try {
    const txt = await fetchText("https://monitorsiogranos.magyp.gob.ar/monitorsiogranos.html");
    // Esta página suele requerir interacción JS; por ahora la usamos como señal de disponibilidad.
    if (/monitor siogranos|mercado disponible/i.test(txt)) {
      advertencias.push(
        "monitorsiogranos disponible, pero sin endpoint público directo de precios en esta captura."
      );
    }
  } catch (e) {
    errores.push(`monitorsiogranos: ${e.message}`);
  }

  // 2) Fallback automático robusto: Monitor Comercio Granario MAGYP
  try {
    const txt = await fetchText("https://monitorssma.magyp.gob.ar/siogranos.dashboardgranos.aspx");
    const items = parseMonitorComercioGranario(txt);
    return { items, errores, advertencias };
  } catch (e) {
    errores.push(`monitorssma: ${e.message}`);
  }

  return { items: [], errores, advertencias };
};

module.exports = {
  obtenerSioGranosAutomatico,
};

