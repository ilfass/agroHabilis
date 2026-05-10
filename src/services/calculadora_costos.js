const norm = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const promedio = ([a, b]) => Number(((Number(a) + Number(b)) / 2).toFixed(2));

const RANGOS_COSTO = {
  soja: {
    propio: [380, 450],
    arrendado: [500, 600],
  },
  maiz: {
    propio: [480, 560],
    arrendado: [620, 720],
  },
  trigo: {
    propio: [280, 350],
    arrendado: [380, 450],
  },
};

const parseCultivo = (cultivo = "") => {
  const c = norm(cultivo);
  if (c.includes("soja")) return "soja";
  if (c.includes("maiz")) return "maiz";
  if (c.includes("trigo")) return "trigo";
  return "soja";
};

/**
 * Estimación de costo USD/ha (perfil o rango regional).
 * El flujo conversacional "guiarCalculoCosto" quedó archivado en `obsoletos/servicios-calculadora-guiar-costo.js`.
 */
const calcularCostoPorHa = async (usuario, cultivo) => {
  const cultivoClave = parseCultivo(cultivo);
  const cultivoUsuario = (usuario?.cultivos || []).find(
    (c) => parseCultivo(c.cultivo) === cultivoClave
  );

  const costoActual = Number(cultivoUsuario?.costo_por_ha);
  if (Number.isFinite(costoActual) && costoActual > 0) {
    return {
      costo_estimado: costoActual,
      es_estimado: false,
      fuente: "usuario_cultivos.costo_por_ha",
    };
  }

  const r = RANGOS_COSTO[cultivoClave] || RANGOS_COSTO.soja;
  const estimado = promedio(r.propio);
  return {
    costo_estimado: estimado,
    es_estimado: true,
    fuente: "promedio_regional",
    rango_usd_ha: r.propio,
  };
};

module.exports = {
  calcularCostoPorHa,
};
