const axios = require("axios");
const cheerio = require("cheerio");

const URL_CAC = "https://www.cac.bcr.com.ar/es/precios-de-pizarra";

const parseFechaDdMmYyyy = (raw) => {
  const m = String(raw || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
};

const parseNumeroEs = (raw) => {
  const cleaned = String(raw || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const obtenerPreciosCAC = async () => {
  const response = await axios.get(URL_CAC, {
    timeout: 60_000,
    headers: { "User-Agent": "Mozilla/5.0 (AgroHabilis/1.0)" },
    validateStatus: (s) => s === 200,
  });

  const $ = cheerio.load(response.data);
  const fecha = parseFechaDdMmYyyy($("h3").first().text());
  if (!fecha) {
    throw new Error("No se encontro fecha en Precios Pizarra CAC");
  }

  const rows = [];
  $(".board-wrapper").each((_idx, el) => {
    const cultivo = $(el).find("h3").first().text().replace(/\s+/g, " ").trim();
    if (!cultivo || cultivo.toLowerCase().includes("precios pizarra")) return;

    const precioArs = parseNumeroEs($(el).find(".price").first().text());
    const firstBottomCell = $(el).find(".bottom .cell").first().text();
    const precioUsd = parseNumeroEs(firstBottomCell);

    if (!Number.isFinite(precioArs) && !Number.isFinite(precioUsd)) return;
    rows.push({
      cultivo,
      mercado: "rosario_cac",
      precio_ars: precioArs,
      precio_usd: precioUsd,
      fecha,
    });
  });

  return rows;
};

module.exports = {
  obtenerPreciosCAC,
};
