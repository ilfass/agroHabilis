const { generarResumen } = require("../services/resumen");
const { obtenerNoticiasFrescas } = require("./base");

module.exports = {
  nombre: "resumen_diario",

  async obtenerDatos(usuario) {
    const generado = await generarResumen(usuario.id);
    const categorias = (generado?.contexto?.metricas || []).map((m) => m.cultivo);
    const noticias = await obtenerNoticiasFrescas(categorias, 3);
    return { generado, noticias };
  },

  async renderizar(_usuario, datos) {
    return {
      mensaje: datos.generado.texto,
      meta: { resumenId: datos.generado.resumenId, noticias: datos.noticias },
    };
  },
};
