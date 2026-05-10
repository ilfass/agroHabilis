const { aplicarLayoutPlanEstricto, bloquePlanPlantilla } = require("../base");

module.exports = ({ mensaje, usuario, fuenteDolar }) => {
  const base = aplicarLayoutPlanEstricto(mensaje, usuario);
  return `${base}\n\n🕒 *Actualizado ahora* (fuente dólar: ${fuenteDolar || "n/a"})\n\n${bloquePlanPlantilla(
    usuario,
    "Vista esencial del plan gratis."
  )}`;
};
