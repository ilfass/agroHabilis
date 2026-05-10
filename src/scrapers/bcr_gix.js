require("dotenv").config();
const axios = require("axios");

const GIX_BASE_URL = "https://api.bcr.com.ar/gix/v1.0";

const CULTIVO_ALIAS = {
  soja: "Soja",
  soya: "Soja",
  maiz: "Maíz",
  maíz: "Maíz",
  trigo: "Trigo",
  girasol: "Girasol",
  sorgo: "Sorgo",
  cebada: "Cebada",
};

const normalizarCultivo = (raw) => {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (!value) return null;
  return CULTIVO_ALIAS[value] || String(raw || "").trim();
};

const toISODate = (raw) => {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
};

const toNumber = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const getToken = async () => {
  const apiKey = process.env.BCR_GIX_API_KEY;
  const secret = process.env.BCR_GIX_SECRET;
  if (!apiKey || !secret) {
    throw new Error("Faltan BCR_GIX_API_KEY/BCR_GIX_SECRET en entorno");
  }

  const response = await axios.post(
    `${GIX_BASE_URL}/Login`,
    {},
    {
      timeout: 20_000,
      headers: {
        api_key: apiKey,
        secret,
        Accept: "application/json",
      },
    }
  );

  const payload = response.data || {};
  return (
    payload.token ||
    payload.access_token ||
    payload.jwt ||
    payload.data?.token ||
    payload.data?.access_token ||
    null
  );
};

const fetchCotizaciones = async ({ token, page = 1 }) => {
  if (!token) throw new Error("No se obtuvo token GIX");
  const response = await axios.get(`${GIX_BASE_URL}/Cotizacion`, {
    timeout: 20_000,
    params: { page },
    headers: {
      Authorization: String(token).startsWith("Bearer ") ? token : `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  return response.data;
};

const mapCotizacion = (row) => {
  const cultivo = normalizarCultivo(
    row?.cultivo ||
      row?.grano ||
      row?.producto ||
      row?.nombreGrano ||
      row?.descripcionGrano
  );
  const precio = toNumber(row?.precio || row?.cotizacion || row?.precioCamara || row?.valor);
  if (!cultivo || !Number.isFinite(precio)) return null;

  return {
    cultivo,
    mercado: "bcr_gix_cotizacion",
    precio_ars: String(row?.moneda || "ARS").toUpperCase() === "USD" ? null : precio,
    precio_usd: String(row?.moneda || "").toUpperCase() === "USD" ? precio : null,
    fecha: toISODate(row?.fecha || row?.fechaConcertacion || row?.fechaProceso || row?.createdAt),
    moneda_origen: row?.moneda || "ARS",
  };
};

const obtenerPreciosBcrGix = async () => {
  const token = await getToken();
  const payload = await fetchCotizaciones({ token, page: 1 });
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.items)
    ? payload.items
    : [];

  return rows.map(mapCotizacion).filter(Boolean);
};

module.exports = {
  obtenerPreciosBcrGix,
};
