const axios = require("axios");
const { obtenerClima, obtenerPrecipitacionAyer } = require("../scrapers/clima");

const LOCALIDADES = [
  { ciudad: "Salta", provincia: "Salta", zona: "NOA", region: "Norte", lat: -24.782127, lng: -65.423197 },
  { ciudad: "San Miguel de Tucuman", provincia: "Tucuman", zona: "NOA", region: "Norte", lat: -26.808285, lng: -65.21759 },
  { ciudad: "Santiago del Estero", provincia: "Santiago del Estero", zona: "NOA", region: "Norte", lat: -27.795111, lng: -64.26149 },
  { ciudad: "Resistencia", provincia: "Chaco", zona: "NEA", region: "Norte", lat: -27.451389, lng: -58.986667 },
  { ciudad: "Posadas", provincia: "Misiones", zona: "NEA", region: "Norte", lat: -27.36708, lng: -55.89608 },
  { ciudad: "Corrientes", provincia: "Corrientes", zona: "NEA", region: "Norte", lat: -27.4806, lng: -58.8341 },
  { ciudad: "Santa Fe", provincia: "Santa Fe", zona: "Centro", region: "Centro", lat: -31.633333, lng: -60.7 },
  { ciudad: "Parana", provincia: "Entre Rios", zona: "Centro", region: "Centro", lat: -31.731972, lng: -60.523801 },
  { ciudad: "Cordoba", provincia: "Cordoba", zona: "Centro", region: "Centro", lat: -31.416668, lng: -64.183334 },
  { ciudad: "Rosario", provincia: "Santa Fe", zona: "Centro", region: "Centro", lat: -32.94682, lng: -60.63932 },
  { ciudad: "Buenos Aires", provincia: "Buenos Aires", zona: "Pampeana", region: "Centro", lat: -34.603722, lng: -58.381592 },
  { ciudad: "La Plata", provincia: "Buenos Aires", zona: "Pampeana", region: "Centro", lat: -34.92145, lng: -57.95453 },
  { ciudad: "Mar del Plata", provincia: "Buenos Aires", zona: "Pampeana", region: "Centro", lat: -38.00228, lng: -57.55754 },
  { ciudad: "Santa Rosa", provincia: "La Pampa", zona: "Pampeana", region: "Centro", lat: -36.61667, lng: -64.28333 },
  { ciudad: "Mendoza", provincia: "Mendoza", zona: "Cuyo", region: "Oeste", lat: -32.889458, lng: -68.84584 },
  { ciudad: "San Juan", provincia: "San Juan", zona: "Cuyo", region: "Oeste", lat: -31.5375, lng: -68.53639 },
  { ciudad: "San Luis", provincia: "San Luis", zona: "Cuyo", region: "Oeste", lat: -33.29501, lng: -66.33563 },
  { ciudad: "Neuquen", provincia: "Neuquen", zona: "Patagonia Norte", region: "Patagonia", lat: -38.95161, lng: -68.0591 },
  { ciudad: "Viedma", provincia: "Rio Negro", zona: "Patagonia Norte", region: "Patagonia", lat: -40.81345, lng: -62.99668 },
  { ciudad: "Comodoro Rivadavia", provincia: "Chubut", zona: "Patagonia Sur", region: "Patagonia", lat: -45.86413, lng: -67.49656 },
  { ciudad: "Rio Gallegos", provincia: "Santa Cruz", zona: "Patagonia Sur", region: "Patagonia", lat: -51.62261, lng: -69.21813 },
  { ciudad: "Ushuaia", provincia: "Tierra del Fuego", zona: "Patagonia Sur", region: "Patagonia", lat: -54.8, lng: -68.3 },
];

const GEOCACHE_TTL_MS = Number(process.env.PRECIP_GEO_TTL_MS || 24 * 60 * 60 * 1000);
const geoCache = new Map();

const normalizar = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const filtrarLocalidades = ({ ciudad, zona, region }) => {
  const ciudadNorm = normalizar(ciudad);
  const zonaNorm = normalizar(zona);
  const regionNorm = normalizar(region);

  return LOCALIDADES.filter((item) => {
    const coincideCiudad = ciudadNorm ? normalizar(item.ciudad).includes(ciudadNorm) : true;
    const coincideZona = zonaNorm ? normalizar(item.zona) === zonaNorm : true;
    const coincideRegion = regionNorm ? normalizar(item.region) === regionNorm : true;
    return coincideCiudad && coincideZona && coincideRegion;
  });
};

const mapearPrecipitaciones = (pronostico = []) =>
  pronostico.map((d) => ({
    fecha: d.fecha,
    precipitacion_mm: d.precipitacion,
    descripcion: d.descripcion,
  }));

const sumarPrecipitacion7d = (pronostico = []) =>
  pronostico.reduce((acc, dia) => {
    const mm = Number(dia.precipitacion);
    return Number.isFinite(mm) ? acc + mm : acc;
  }, 0);

const getGeoCache = (cacheKey) => {
  const hit = geoCache.get(cacheKey);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    geoCache.delete(cacheKey);
    return null;
  }
  return hit.value;
};

const setGeoCache = (cacheKey, value) => {
  geoCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + GEOCACHE_TTL_MS,
  });
};

const buscarCiudadDinamica = async (ciudad) => {
  const termino = String(ciudad || "").trim();
  if (!termino) return null;
  const cacheKey = normalizar(termino);
  const cached = getGeoCache(cacheKey);
  if (cached) return { ...cached, cacheGeocoding: true };

  const response = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: {
      q: `${termino}, Argentina`,
      format: "json",
      limit: 1,
      countrycodes: "ar",
      addressdetails: 1,
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

  const addr = row.address || {};
  const ciudadDetectada =
    addr.city || addr.town || addr.village || addr.municipality || termino;
  const provinciaDetectada =
    addr.state || addr.province || addr.region || "Argentina";

  const localidad = {
    ciudad: ciudadDetectada,
    provincia: provinciaDetectada,
    zona: "Dinamica",
    region: "Dinamica",
    lat,
    lng,
    fuenteUbicacion: "nominatim",
    cacheGeocoding: false,
  };
  setGeoCache(cacheKey, localidad);
  return localidad;
};

const construirResultado = async (localidad) => {
  const pronostico = await obtenerClima(localidad.lat, localidad.lng);
  let ayer = { fecha: null, precipitacion_mm: null };
  try {
    ayer = await obtenerPrecipitacionAyer(localidad.lat, localidad.lng);
  } catch (_error) {
    // Si falla el historico, mantenemos respuesta de pronostico sin romper la API.
  }
  return {
    ciudad: localidad.ciudad,
    provincia: localidad.provincia,
    zona: localidad.zona,
    region: localidad.region,
    lat: localidad.lat,
    lng: localidad.lng,
    fuenteUbicacion: localidad.fuenteUbicacion || "catalogo",
    cacheGeocoding: Boolean(localidad.cacheGeocoding),
    precipitacion_ayer: {
      fecha: ayer.fecha,
      precipitacion_mm: ayer.precipitacion_mm,
      fuente: ayer.fuente || null,
    },
    precipitacion_total_7d_mm: Number(sumarPrecipitacion7d(pronostico).toFixed(2)),
    dias: mapearPrecipitaciones(pronostico),
  };
};

const obtenerPrecipitacionesNacionales = async (filtros = {}) => {
  const localidades = filtrarLocalidades(filtros);
  const resultados = [];

  for (const localidad of localidades) {
    resultados.push(await construirResultado(localidad));
  }

  if (!resultados.length && filtros?.ciudad) {
    const localidadDinamica = await buscarCiudadDinamica(filtros.ciudad);
    if (localidadDinamica) {
      resultados.push(await construirResultado(localidadDinamica));
    }
  }

  return {
    filtros: {
      ciudad: filtros.ciudad || null,
      zona: filtros.zona || null,
      region: filtros.region || null,
    },
    totalLocalidades: resultados.length,
    items: resultados,
  };
};

module.exports = {
  obtenerPrecipitacionesNacionales,
  LOCALIDADES,
};
