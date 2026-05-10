const { aplicarLayoutPlanEstricto, bloquePlanPlantilla } = require("../base");

module.exports = ({ mensaje, usuario }) => {
  const base = aplicarLayoutPlanEstricto(mensaje, usuario);
  return `${base}\n\n${bloquePlanPlantilla(
    usuario,
    "Bloques habilitados: precio, clima, radar y oportunidad/riesgos."
  )}`;
};
