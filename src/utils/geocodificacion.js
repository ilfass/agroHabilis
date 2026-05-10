"use strict";

const axios = require("axios");

/**
 * Resuelve lat/lng para partido + provincia (Argentina) vía Nominatim.
 */
const geocodificarZonaArgentina = async ({ partido, provincia } = {}) => {
  if (!partido || !provincia) return null;
  const response = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: {
      q: `${partido}, ${provincia}, Argentina`,
      format: "json",
      limit: 1,
    },
    timeout: 30_000,
    headers: {
      "User-Agent": "AgroHabilis/1.0 (soporte@agrohabilis.com)",
    },
    validateStatus: (s) => s === 200,
  });

  const row = Array.isArray(response.data) ? response.data[0] : null;
  if (!row) return null;
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

module.exports = { geocodificarZonaArgentina };
