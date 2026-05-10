const axios = require("axios");
const { TZ_AR } = require("../utils/fecha_ar");

const URL_DOLAR = "https://dolarapi.com/v1/dolares";
const URL_BLUELYTICS = "https://api.bluelytics.com.ar/v2/latest";
const TIPOS = new Set(["oficial", "blue", "bolsa", "contadoconliqui", "ccl"]);

/** Fecha calendario Argentina desde un instante ISO (evita día “UTC” en VPS). */
const toDateOnly = (isoDate) => {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: TZ_AR });
};

const normalizeTipo = (casa) => {
  if (casa === "contadoconliqui") return "ccl";
  return casa;
};

const obtenerDesdeDolarApi = async () => {
  const response = await axios.get(URL_DOLAR, {
    timeout: 60_000,
    headers: { "User-Agent": "Mozilla/5.0 (AgroHabilis/1.0)" },
    validateStatus: (s) => s === 200,
  });

  const rows = Array.isArray(response.data) ? response.data : [];

  return rows
    .filter((r) => TIPOS.has(r.casa))
    .map((r) => ({
      tipo: normalizeTipo(r.casa),
      compra: Number(r.compra),
      venta: Number(r.venta),
      fecha: toDateOnly(r.fechaActualizacion),
    }))
    .filter((r) => r.fecha && Number.isFinite(r.compra) && Number.isFinite(r.venta));
};

const obtenerDesdeBluelytics = async () => {
  const response = await axios.get(URL_BLUELYTICS, {
    timeout: 60_000,
    headers: { "User-Agent": "Mozilla/5.0 (AgroHabilis/1.0)" },
    validateStatus: (s) => s === 200,
  });
  const data = response.data || {};
  const fecha = toDateOnly(new Date());
  const out = [];

  const oficial = Number(data?.oficial?.value_sell);
  if (Number.isFinite(oficial)) {
    out.push({
      tipo: "oficial",
      compra: Number(data?.oficial?.value_buy) || oficial,
      venta: oficial,
      fecha,
    });
  }
  const blue = Number(data?.blue?.value_sell);
  if (Number.isFinite(blue)) {
    out.push({
      tipo: "blue",
      compra: Number(data?.blue?.value_buy) || blue,
      venta: blue,
      fecha,
    });
  }
  return out.filter((r) => Number.isFinite(r.venta));
};

const obtenerTipoCambio = async () => {
  try {
    const main = await obtenerDesdeDolarApi();
    if (main.length) return main;
  } catch (error) {
    console.warn("[Dolar] DolarAPI falló, probando fallback Bluelytics:", error.message);
  }
  const fallback = await obtenerDesdeBluelytics();
  if (fallback.length) return fallback;
  throw new Error("Sin datos válidos de tipo de cambio (DolarAPI/Bluelytics)");
};

module.exports = {
  obtenerTipoCambio,
};
