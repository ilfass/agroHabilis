const { bloquePlanPlantilla } = require("../base");

module.exports = ({ mensaje, usuario }) =>
  `${mensaje}\n\n${bloquePlanPlantilla(
    usuario,
    "Alerta esencial con precio, variación y recomendación breve."
  )}`;
