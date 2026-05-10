const axios = require("axios");
const cheerio = require("cheerio");

const URL_AFA = "https://www.afascl.coop/afadiario/mercados-en-linea";

const parseFechaDdMmYyyy = (raw) => {
  const m = String(raw || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
};

const parseNumeroFlexible = (raw) => {
  const input = String(raw || "").replace(/[^\d,.\-]/g, "");
  if (!input) return null;

  const hasDot = input.includes(".");
  const hasComma = input.includes(",");
  let normalized = input;

  if (hasDot && hasComma) {
    // Si termina en ",dd" usamos coma decimal; si no, asumimos punto decimal.
    if (input.lastIndexOf(",") > input.lastIndexOf(".")) {
      normalized = input.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = input.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = input.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = input.replace(/,/g, "");
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const slug = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const obtenerPreciosAFA = async () => {
  const response = await axios.get(URL_AFA, {
    timeout: 60_000,
    headers: { "User-Agent": "Mozilla/5.0 (AgroHabilis/1.0)" },
    validateStatus: (s) => s === 200,
  });

  const $ = cheerio.load(response.data);

  const locales = [];
  $("div.bg-light.border.rounded").each((_idx, el) => {
    const cultivo = $(el)
      .find(".lead.font-weight-bold")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const plaza = $(el)
      .find("small.text-muted")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const fecha = parseFechaDdMmYyyy($(el).find(".badge.badge-dark.float-right").first().text());
    const precioArs = parseNumeroFlexible($(el).find("h4").first().text());

    if (!cultivo || !plaza || !fecha || precioArs === null) return;
    locales.push({
      cultivo,
      mercado: `afa_${slug(plaza)}`,
      precio_ars: precioArs,
      fecha,
    });
  });

  const futurosCbot = [];
  const tableCbot = $("table")
    .filter((_i, table) => $(table).text().includes("CMA - CBOT"))
    .first();

  const fechaCbot = parseFechaDdMmYyyy(tableCbot.text());
  tableCbot.find("tr").each((_idx, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 4) return;
    const cultivo = $(tds[0]).text().replace(/\s+/g, " ").trim();
    const posicion = $(tds[1]).text().replace(/\s+/g, " ").trim();
    const diferencia = parseNumeroFlexible($(tds[2]).text());
    const precioUsd = parseNumeroFlexible($(tds[3]).text());

    if (!cultivo || !posicion || precioUsd === null) return;
    futurosCbot.push({
      cultivo,
      posicion,
      diferencia,
      precio_usd: precioUsd,
      fecha: fechaCbot,
    });
  });

  return { locales, futurosCbot };
};

module.exports = {
  obtenerPreciosAFA,
};
