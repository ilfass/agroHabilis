const { PLAN_PRICES_CACHE } = require("../services/planes");

const PLAN_SCHEMA = {
  gratis: {
    bloques: 13,
    get precio() {
      return `$${Number(PLAN_PRICES_CACHE.gratis || 0).toLocaleString("es-AR")}/mes`;
    },
    permitidos: [
      "precios",
      "tipo_cambio",
      "clima",
      "situacion",
      "consejo",
      "oportunidad_venta",
      "riesgos_operativos",
      "noticias",
      "finanzas",
      "hacienda",
      "insights_pro",
      "escenarios_pro",
      "termometro_pro",
      "alertas_pro",
      "radar_web_pro_completo",
      "plan_info",
    ],
    prohibidos: [],
  },
  basico: {
    bloques: 13,
    get precio() {
      return `$${Number(PLAN_PRICES_CACHE.basico || 22000).toLocaleString("es-AR")}/mes`;
    },
    permitidos: [
      "precios",
      "tipo_cambio",
      "clima",
      "situacion",
      "consejo",
      "oportunidad_venta",
      "riesgos_operativos",
      "noticias",
      "finanzas",
      "hacienda",
      "insights_pro",
      "escenarios_pro",
      "termometro_pro",
      "alertas_pro",
      "radar_web_pro_completo",
      "plan_info",
    ],
    prohibidos: [],
  },
  pro: {
    bloques: 13,
    get precio() {
      return `$${Number(PLAN_PRICES_CACHE.pro || 29000).toLocaleString("es-AR")}/mes`;
    },
    permitidos: [
      "precios",
      "tipo_cambio",
      "clima",
      "situacion",
      "consejo",
      "oportunidad_venta",
      "riesgos_operativos",
      "noticias",
      "finanzas",
      "hacienda",
      "insights_pro",
      "escenarios_pro",
      "termometro_pro",
      "alertas_pro",
      "radar_web_pro_completo",
      "plan_info",
    ],
    prohibidos: [],
  },
  pro_max: {
    bloques: 13,
    get precio() {
      return `$${Number(PLAN_PRICES_CACHE.pro_max || 50000).toLocaleString("es-AR")}/mes`;
    },
    permitidos: [
      "precios",
      "tipo_cambio",
      "clima",
      "situacion",
      "consejo",
      "oportunidad_venta",
      "riesgos_operativos",
      "noticias",
      "finanzas",
      "hacienda",
      "insights_pro",
      "escenarios_pro",
      "termometro_pro",
      "alertas_pro",
      "radar_web_pro_completo",
      "plan_info",
    ],
    prohibidos: [],
  },
};

module.exports = {
  PLAN_SCHEMA,
};
