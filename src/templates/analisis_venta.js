const { analizarConvenienciaVentaRaw } = require("../services/analisis_venta");
const { obtenerPrecioFresco, obtenerDolarFresco, obtenerNoticiasFrescas } = require("./base");

module.exports = {
  nombre: "analisis_venta",

  async obtenerDatos(usuario, cultivo) {
    const precio_disponible = await obtenerPrecioFresco(cultivo, 0);
    const dolar = await obtenerDolarFresco(0);
    const noticias = await obtenerNoticiasFrescas([cultivo], 3);
    const analisis = await analizarConvenienciaVentaRaw(usuario, cultivo);
    return { cultivo, precio_disponible, dolar, noticias, analisis };
  },

  async renderizar(_usuario, datos) {
    const noticiasTxt = (datos.noticias || []).map((n) => `- ${n}`).join("\n");
    return {
      mensaje: `${datos.analisis}\n\n📰 *Contexto reciente*\n${noticiasTxt || "- Sin noticias relevantes recientes."}`,
      meta: {},
    };
  },
};
