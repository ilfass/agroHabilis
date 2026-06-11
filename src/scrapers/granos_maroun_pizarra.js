"use strict";

const axios = require("axios");
const cheerio = require("cheerio");

const URL = "https://www.maroun.com.ar/";
const UA = { "User-Agent": "AgroHabilis/1.0 (+maroun-pizarra)" };

const PLAZAS = ["rosario", "bahia_blanca", "quequen", "darsena"];

const normalizarNombreCultivo = (raw = "") => {
  const t = String(raw).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (t === "maiz" || t === "maíz") return "maiz";
  if (t === "trigo") return "trigo";
  if (t === "girasol") return "girasol";
  if (t === "soja") return "soja";
  if (t === "sorgo") return "sorgo";
  if (t === "cebada") return "cebada";
  return null;
};

const parseNum = (s) => {
  const t = String(s || "").replace(/\*/g, "").replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  if (/^\d+[.,]\d{1,3}$/.test(t)) return Number(t.replace(",", "."));
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Extrae ARS (grandes) y USD (típico 50–800) desde una celda de pizarra.
 */
const extraerArsUsdCelda = (html = "") => {
  const t = String(html).replace(/\s+/g, " ");
  const mArsParen = t.match(/\(\s*\$\s*([\d.]+)\s*\)/);
  const mUsdParen = t.match(/\(\s*us\$\s*([\d.,]+)\s*\)/i);
  let ars = mArsParen ? parseNum(mArsParen[1]) : null;
  let usd = mUsdParen ? parseNum(mUsdParen[1]) : null;
  const lead = t.match(/^([\d.,*]+)/);
  if (lead) {
    const n = parseNum(lead[1]);
    if (n != null) {
      if (!ars && n >= 20_000) ars = n;
      if (!usd && n >= 50 && n < 2000 && !mUsdParen) {
        if (mArsParen && n < 2000) usd = n;
        else if (!mArsParen && n < 2000) usd = n;
      }
    }
  }
  if (t.trim() === "-" || t.trim() === "–") return { ars: null, usd: null };
  return { ars, usd };
};

const parseFechaTabla = ($tab) => {
  const txt = $tab.find("thead span.fecha").first().text();
  const m = String(txt).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
};

/**
 * Pizarra granos Maroun (varias plazas, ARS / USD).
 * https://www.maroun.com.ar/
 */
const obtenerPreciosMarounPizarra = async () => {
  const res = await axios.get(URL, {
    timeout: 45_000,
    headers: UA,
    validateStatus: (s) => s === 200,
  });
  const $ = cheerio.load(res.data);
  const $box = $("div.box_pizarra").filter((_i, el) => {
    const t = $(el).find(".box_title h4").first().text();
    return /pizarra/i.test(t) && /pesos|d[oó]lares/i.test(t);
  });
  const $tab = $box.first().find("table.table_home").first();
  if (!$tab.length) {
    throw new Error("Maroun: no se encontró tabla de pizarra");
  }

  const fecha = parseFechaTabla($tab);
  if (!fecha) {
    throw new Error("Maroun: no se pudo leer fecha de la pizarra");
  }

  const items = [];
  $tab.find("tbody tr").each((_i, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 9) return;
    const cultivo = normalizarNombreCultivo($(tds[0]).text());
    if (!cultivo) return;

    for (let p = 0; p < 4; p += 1) {
      const plaza = PLAZAS[p];
      const htmlArs = $(tds[1 + p * 2]).html() || "";
      const htmlUsd = $(tds[2 + p * 2]).html() || "";
      const { ars: arsA, usd: usdA } = extraerArsUsdCelda(htmlArs);
      const { ars: arsB, usd: usdB } = extraerArsUsdCelda(htmlUsd);
      const ars = arsA ?? arsB;
      const usd = usdA ?? usdB;

      if (Number.isFinite(ars)) {
        items.push({
          cultivo,
          mercado: `MAROUN_${plaza}_ARS`,
          precio_ars: ars,
          precio_usd: null,
          fecha,
          fuente: "maroun_pizarra",
          tipo_precio: "referencia",
        });
      }
      if (Number.isFinite(usd)) {
        items.push({
          cultivo,
          mercado: `MAROUN_${plaza}_USD`,
          precio_ars: null,
          precio_usd: usd,
          fecha,
          fuente: "maroun_pizarra",
          tipo_precio: "referencia",
        });
      }
    }
  });

  return items;
};

module.exports = {
  obtenerPreciosMarounPizarra,
  URL_MAROUN_PIZARRA: URL,
};
