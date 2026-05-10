const { aplicarLayoutPlanEstricto, bloquePlanPlantilla } = require("../base");

module.exports = ({ mensaje, usuario }) => {
  const base = aplicarLayoutPlanEstricto(mensaje, usuario);
  return `${base}\n\n${bloquePlanPlantilla(usuario, "Incluye resumen esencial y muestra trial.")}`;
};
