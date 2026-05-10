const { generarResumen } = require("../services/resumen");
const { obtenerNoticiasFrescas } = require("./base");
const { aplicarLayout } = require("./layouts");

module.exports = {
  nombre: "resumen_diario",

  async obtenerDatos(usuario) {
    const generado = await generarResumen(usuario.id);
    const categorias = (generado?.contexto?.metricas || []).map((m) => m.cultivo);
    const noticias = await obtenerNoticiasFrescas(categorias, 3);
    return { generado, noticias };
  },

  async renderizar(_usuario, datos) {
    const base = aplicarLayout("resumen_diario", _usuario, { mensaje: datos.generado.texto });
    return {
      mensaje: base,
      meta: { resumenId: datos.generado.resumenId, noticias: datos.noticias },
    };
  },
};
