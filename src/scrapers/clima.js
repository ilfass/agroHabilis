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

const obtenerFechaAyerIso = () => {
  const now = new Date();
  const ayer = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return ayer.toISOString().slice(0, 10);
};

const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY?.trim();
const WEATHERAPI_BASE_URL =
  process.env.WEATHERAPI_BASE_URL?.trim() || "https://api.weatherapi.com/v1";

const validarCoordenadas = (lat, lng, fnName) => {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Lat/Lng invalidas para ${fnName}`);
  }
  return { latitude, longitude };
};

const construirDescripcionDesdeWeatherApi = (day = {}) => {
  const text = String(day?.condition?.text || "").trim();
  if (text) return text;
  const willRain = Number(day?.daily_will_it_rain) === 1;
  if (willRain) return "Lluvia";
  return "Condiciones variables";
};

const obtenerClimaWeatherApi = async (latitude, longitude) => {
  if (!WEATHERAPI_KEY) {
    throw new Error("WEATHERAPI_KEY no configurada");
  }
  const response = await axios.get(`${WEATHERAPI_BASE_URL}/forecast.json`, {
    params: {
      key: WEATHERAPI_KEY,
      q: `${latitude},${longitude}`,
      days: 7,
      aqi: "no",
      alerts: "no",
      lang: "es",
    },
    timeout: 60_000,
    validateStatus: (s) => s === 200,
  });
  const forecastDays = Array.isArray(response.data?.forecast?.forecastday)
    ? response.data.forecast.forecastday
    : [];
  return forecastDays.map((item) => {
    const day = item.day || {};
    const tempMin = Number(day.mintemp_c);
    const tempMax = Number(day.maxtemp_c);
    const precipitacion = Number(day.totalprecip_mm);
    return {
      lat: latitude,
      lng: longitude,
      fecha: item.date,
      temp_min: Number.isFinite(tempMin) ? tempMin : null,
      temp_max: Number.isFinite(tempMax) ? tempMax : null,
      precipitacion: Number.isFinite(precipitacion) ? precipitacion : null,
      helada: Number.isFinite(tempMin) ? tempMin < 2 : false,
      descripcion: construirDescripcionDesdeWeatherApi(day),
      fuente: "weatherapi",
    };
  });
};

const obtenerPrecipitacionAyerWeatherApi = async (latitude, longitude, fecha) => {
  if (!WEATHERAPI_KEY) {
    throw new Error("WEATHERAPI_KEY no configurada");
  }
  const response = await axios.get(`${WEATHERAPI_BASE_URL}/history.json`, {
    params: {
      key: WEATHERAPI_KEY,
      q: `${latitude},${longitude}`,
      dt: fecha,
      lang: "es",
    },
    timeout: 60_000,
    validateStatus: (s) => s === 200,
  });
  const forecastDay = response.data?.forecast?.forecastday?.[0]?.day;
  const mm = Number(forecastDay?.totalprecip_mm);
  return {
    fecha,
    precipitacion_mm: Number.isFinite(mm) ? mm : null,
    fuente: "weatherapi",
  };
};

const obtenerClima = async (lat, lng) => {
  const { latitude, longitude } = validarCoordenadas(lat, lng, "obtenerClima");
  try {
    return await obtenerClimaWeatherApi(latitude, longitude);
  } catch (error) {
    const response = await axios.get("https://api.open-meteo.com/v1/forecast", {
      params: {
        latitude,
        longitude,
        daily:
          "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,wind_speed_10m_max",
        timezone: "America/Argentina/Buenos_Aires",
        forecast_days: 7,
        windspeed_unit: "kmh",
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
    const vientosMax = Array.isArray(daily?.wind_speed_10m_max) ? daily.wind_speed_10m_max : [];

    return fechas.map((fecha, i) => {
      const tempMin = Number(minimas[i]);
      const tempMax = Number(maximas[i]);
      const precipitacion = Number(precipitaciones[i]);
      const code = Number(codigos[i]);
      const vMax = Number(vientosMax[i]);
      const baseDesc = Number.isFinite(code)
        ? descripcionPorWeatherCode(code)
        : "Condiciones variables";
      const vientoTxt =
        Number.isFinite(vMax) && vMax > 0
          ? ` · viento máx ~${Math.round(vMax)} km/h`
          : "";

      return {
        lat: latitude,
        lng: longitude,
        fecha,
        temp_min: Number.isFinite(tempMin) ? tempMin : null,
        temp_max: Number.isFinite(tempMax) ? tempMax : null,
        precipitacion: Number.isFinite(precipitacion) ? precipitacion : null,
        helada: Number.isFinite(tempMin) ? tempMin < 2 : false,
        descripcion: `${baseDesc}${vientoTxt}`,
        fuente: "open-meteo",
      };
    });
  }
};

const obtenerPrecipitacionAyer = async (lat, lng) => {
  const { latitude, longitude } = validarCoordenadas(
    lat,
    lng,
    "obtenerPrecipitacionAyer"
  );

  const fecha = obtenerFechaAyerIso();
  try {
    return await obtenerPrecipitacionAyerWeatherApi(latitude, longitude, fecha);
  } catch (error) {
    const response = await axios.get("https://archive-api.open-meteo.com/v1/archive", {
      params: {
        latitude,
        longitude,
        start_date: fecha,
        end_date: fecha,
        daily: "precipitation_sum",
        timezone: "America/Argentina/Buenos_Aires",
      },
      timeout: 60_000,
      validateStatus: (s) => s === 200,
    });

    const daily = response.data?.daily;
    const fechas = Array.isArray(daily?.time) ? daily.time : [];
    const precipitaciones = Array.isArray(daily?.precipitation_sum)
      ? daily.precipitation_sum
      : [];
    const idx = fechas.findIndex((f) => f === fecha);
    if (idx < 0) return { fecha, precipitacion_mm: null, fuente: "open-meteo" };
    const mm = Number(precipitaciones[idx]);
    return {
      fecha,
      precipitacion_mm: Number.isFinite(mm) ? mm : null,
      fuente: "open-meteo",
    };
  }
};

module.exports = {
  obtenerClima,
  obtenerPrecipitacionAyer,
};
