const { analizarConvenienciaVentaRaw } = require("../services/analisis_venta");
const { obtenerPrecioFresco, obtenerDolarFresco, obtenerNoticiasFrescas } = require("./base");
const { aplicarLayout } = require("./layouts");

const resumirNoticia = (n = {}) => {
  const titulo = String(n?.titulo || "").trim();
  const fuente = String(n?.fuente || "").trim();
  const resumen = String(n?.resumen || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 520);
  const cuerpo = resumen || "Sin bajada disponible en la fuente.";
  return [`- 📰 ${titulo}${fuente ? ` (${fuente})` : ""}`, cuerpo].filter(Boolean).join("\n");
};

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
    const noticiasTxt = (datos.noticias || []).map((n) => resumirNoticia(n)).join("\n\n");
    const base = `${datos.analisis}\n\n📰 *Contexto reciente*\n${
      noticiasTxt || "- Sin noticias relevantes recientes."
    }`;
    return {
      mensaje: aplicarLayout("analisis_venta", _usuario, { mensaje: base }),
      meta: {},
    };
  },
};
