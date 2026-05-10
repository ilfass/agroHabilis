const { bloquePlanPlantilla } = require("../base");

module.exports = ({ mensaje, usuario }) =>
  `${mensaje}\n\n${bloquePlanPlantilla(
    usuario,
    "Análisis resumido de venta con recomendación principal."
  )}`;
