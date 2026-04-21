const axios = require("axios");

const WEATHER_CODE_DESCRIPCIONES = {
  0: "Despejado",
  1: "Parcialmente nublado",
  2: "Parcialmente nublado",
  3: "Parcialmente nublado",
  61: "Lluvia",
  63: "Lluvia",
  65: "Lluvia",
  66: "Lluvia",
  67: "Lluvia",
  71: "Nieve",
  73: "Nieve",
  75: "Nieve",
  77: "Nieve",
  80: "Lluvias",
  81: "Lluvias",
  82: "Lluvias",
};

const descripcionPorWeatherCode = (code) => {
  if (Object.hasOwn(WEATHER_CODE_DESCRIPCIONES, code)) {
    return WEATHER_CODE_DESCRIPCIONES[code];
  }
  return "Condiciones variables";
};

const obtenerClima = async (lat, lng) => {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Lat/Lng invalidas para obtenerClima");
  }

  const response = await axios.get("https://api.open-meteo.com/v1/forecast", {
    params: {
      latitude,
      longitude,
      daily:
        "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
      timezone: "America/Argentina/Buenos_Aires",
      forecast_days: 7,
    },
    timeout: 60_000,
    validateStatus: (s) => s === 200,
  });

  const daily = response.data?.daily;
  const fechas = Array.isArray(daily?.time) ? daily.time : [];
  const maximas = Array.isArray(daily?.temperature_2m_max)
    ? daily.temperature_2m_max
    : [];
  const minimas = Array.isArray(daily?.temperature_2m_min)
    ? daily.temperature_2m_min
    : [];
  const precipitaciones = Array.isArray(daily?.precipitation_sum)
    ? daily.precipitation_sum
    : [];
  const codigos = Array.isArray(daily?.weathercode) ? daily.weathercode : [];

  return fechas.map((fecha, i) => {
    const tempMin = Number(minimas[i]);
    const tempMax = Number(maximas[i]);
    const precipitacion = Number(precipitaciones[i]);
    const code = Number(codigos[i]);

    return {
      lat: latitude,
      lng: longitude,
      fecha,
      temp_min: Number.isFinite(tempMin) ? tempMin : null,
      temp_max: Number.isFinite(tempMax) ? tempMax : null,
      precipitacion: Number.isFinite(precipitacion) ? precipitacion : null,
      helada: Number.isFinite(tempMin) ? tempMin < 2 : false,
      descripcion: Number.isFinite(code)
        ? descripcionPorWeatherCode(code)
        : "Condiciones variables",
    };
  });
};

module.exports = {
  obtenerClima,
};
