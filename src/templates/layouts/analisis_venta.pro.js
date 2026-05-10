const { bloquePlanPlantilla } = require("../base");

module.exports = ({ mensaje, usuario }) =>
  `${mensaje}\n\n${bloquePlanPlantilla(
    usuario,
    "Análisis PRO completo con estrategia y alternativa."
  )}`;
