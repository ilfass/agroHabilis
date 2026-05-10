const { aplicarLayoutPlanEstricto, bloquePlanPlantilla } = require("../base");

module.exports = ({ mensaje, usuario }) => {
  const base = aplicarLayoutPlanEstricto(mensaje, usuario);
  return `${base}\n\n${bloquePlanPlantilla(
    usuario,
    "Incluye campaña/hacienda + bloques PRO completos."
  )}`;
};
