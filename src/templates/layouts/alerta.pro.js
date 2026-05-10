const { bloquePlanPlantilla } = require("../base");

module.exports = ({ mensaje, usuario }) =>
  `${mensaje}\n\n${bloquePlanPlantilla(
    usuario,
    "Alerta PRO con foco en decisión y seguimiento inmediato."
  )}`;
