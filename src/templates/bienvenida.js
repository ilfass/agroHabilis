const { generarPrimerResumen } = require("../services/primer_resumen");
const {
  obtenerPrecioFresco,
  obtenerDolarFresco,
  obtenerClimaFresco,
} = require("./base");

module.exports = {
  nombre: "bienvenida",

  async obtenerDatos(usuario) {
    const cultivos = (usuario?.cultivos || []).map((c) => c.cultivo || c).filter(Boolean);
    const precios = await Promise.all(cultivos.map((c) => obtenerPrecioFresco(c, 0)));
    const dolar = await obtenerDolarFresco(0);
    const clima = usuario?.lat != null && usuario?.lng != null
      ? await obtenerClimaFresco(usuario.lat, usuario.lng, 0)
      : { items: [], fuente: "sin_geo" };
    return { cultivos, precios, dolar, clima };
  },

  async renderizar(usuario, _datos, opts = {}) {
    const generado = await generarPrimerResumen(usuario, { enviar: opts?.enviar !== false });
    return {
      mensaje: generado.texto,
      meta: {
        template: "bienvenida",
        resumenId: generado.resumenId,
        whatsappMessageId: generado.whatsappMessageId,
      },
    };
  },
};
