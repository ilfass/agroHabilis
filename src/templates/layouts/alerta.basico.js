const { bloquePlanPlantilla } = require("../base");

module.exports = ({ mensaje, usuario }) =>
  `${mensaje}\n\n${bloquePlanPlantilla(
    usuario,
    "Alerta ampliada con contexto operativo y CTA de análisis."
  )}`;
