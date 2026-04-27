const { generarResumen } = require("../services/resumen");
const { obtenerDolarFresco } = require("./base");

module.exports = {
  nombre: "mi_resumen",

  async obtenerDatos(usuario) {
    const generado = await generarResumen(usuario.id);
    const dolar = await obtenerDolarFresco(0);
    return { generado, dolar };
  },

  async renderizar(_usuario, datos) {
    const marca = `\n\n🕒 *Actualizado ahora* (fuente dólar: ${datos.dolar.fuente || "n/a"})`;
    return {
      mensaje: `${datos.generado.texto}${marca}`,
      meta: { resumenId: datos.generado.resumenId },
    };
  },
};
