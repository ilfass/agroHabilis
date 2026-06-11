"use strict";

const axios = require("axios");
const cheerio = require("cheerio");

const URL = "https://www.magyp.gob.ar/mercadosagropecuarios/precios.php";
const UA = { "User-Agent": "AgroHabilis/1.0 (+magyp-precios-php)" };

const parseFechaTitulo = (txt = "") => {
  const m = String(txt).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
};

const toNum = (raw) => {
  if (raw == null) return null;
  const s = String(raw).replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return Number(s.replace(/\./g, "").replace(",", "."));
  }
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Cotizaciones MAGYP en HTML (incluye cebada cervecera / forrajera y FAS en ARS).
 * Fuente: https://www.magyp.gob.ar/mercadosagropecuarios/precios.php
 */
const obtenerPreciosMagypPreciosPhp = async () => {
  const res = await axios.get(URL, {
    timeout: 45_000,
    headers: UA,
    validateStatus: (s) => s === 200,
  });
  const $ = cheerio.load(res.data);
  const titulo = $("h3.titulocoti").first().text();
  const fecha = parseFechaTitulo(titulo) || null;
  if (!fecha) {
    throw new Error("MAGYP precios.php: no se pudo leer fecha del titulo");
  }

  const items = [];
  $("p.pad").each((_i, el) => {
    const $p = $(el);
    const alt = String($p.find("img[alt]").first().attr("alt") || "").trim().toLowerCase();
    if (!alt) return;

    const textoPlano = $p.text().replace(/\s+/g, " ").trim();
    const fobM = textoPlano.match(/FOB:\s*(\d+)\s*USD\/t/i);
    const fobUsd = fobM ? toNum(fobM[1]) : null;

    let resto = fobM ? textoPlano.slice(textoPlano.indexOf(fobM[0]) + fobM[0].length) : textoPlano;
    const arsM = resto.match(/([\d.]+)\s*\$\s*\/\s*t/i);
    const fasArs = arsM ? toNum(arsM[1]) : null;

    const mapMercado = (suf) => `MAGYP_PRECIO_PHP_${suf}`;

    if (alt === "cebada cervecera") {
      if (Number.isFinite(fobUsd)) {
        items.push({
          cultivo: "cebada",
          mercado: mapMercado("FOB_CERVECERA"),
          precio_usd: fobUsd,
          precio_ars: null,
          fecha,
          fuente: "magyp_precios_php",
          tipo_precio: "referencia",
          presentacion: "cervecera",
        });
      }
      if (Number.isFinite(fasArs)) {
        items.push({
          cultivo: "cebada",
          mercado: mapMercado("FAS_ARS_CERVECERA"),
          precio_ars: fasArs,
          precio_usd: null,
          fecha,
          fuente: "magyp_precios_php",
          tipo_precio: "referencia",
          presentacion: "cervecera",
        });
      }
      return;
    }
    if (alt === "cebada forrajera") {
      if (Number.isFinite(fobUsd)) {
        items.push({
          cultivo: "cebada",
          mercado: mapMercado("FOB_FORRAJERA"),
          precio_usd: fobUsd,
          precio_ars: null,
          fecha,
          fuente: "magyp_precios_php",
          tipo_precio: "referencia",
          presentacion: "forrajera",
        });
      }
      if (Number.isFinite(fasArs)) {
        items.push({
          cultivo: "cebada",
          mercado: mapMercado("FAS_ARS_FORRAJERA"),
          precio_ars: fasArs,
          precio_usd: null,
          fecha,
          fuente: "magyp_precios_php",
          tipo_precio: "referencia",
          presentacion: "forrajera",
        });
      }
      return;
    }

    const cultivosSimple = ["trigo", "maiz", "girasol", "soja", "sorgo"];
    if (!cultivosSimple.includes(alt)) return;

    if (Number.isFinite(fobUsd)) {
      items.push({
        cultivo: alt,
        mercado: mapMercado(`FOB_${alt.toUpperCase()}`),
        precio_usd: fobUsd,
        precio_ars: null,
        fecha,
        fuente: "magyp_precios_php",
        tipo_precio: "referencia",
      });
    }
    if (Number.isFinite(fasArs)) {
      items.push({
        cultivo: alt,
        mercado: mapMercado(`FAS_ARS_${alt.toUpperCase()}`),
        precio_ars: fasArs,
        precio_usd: null,
        fecha,
        fuente: "magyp_precios_php",
        tipo_precio: "referencia",
      });
    }
  });

  return items;
};

module.exports = {
  obtenerPreciosMagypPreciosPhp,
  URL_MAGYP_PRECIOS_PHP: URL,
};
