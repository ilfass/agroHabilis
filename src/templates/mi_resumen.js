const { generarResumen } = require("../services/resumen");
const { obtenerDolarFresco } = require("./base");
const { aplicarLayout } = require("./layouts");

const normalizarFechasEspanol = (txt = "") => {
  const map = new Map([
    ["monday", "lunes"],
    ["tuesday", "martes"],
    ["wednesday", "miercoles"],
    ["thursday", "jueves"],
    ["friday", "viernes"],
    ["saturday", "sabado"],
    ["sunday", "domingo"],
    ["mon", "lun"],
    ["tue", "mar"],
    ["wed", "mie"],
    ["thu", "jue"],
    ["fri", "vie"],
    ["sat", "sab"],
    ["sun", "dom"],
    ["january", "enero"],
    ["february", "febrero"],
    ["march", "marzo"],
    ["april", "abril"],
    ["may", "mayo"],
    ["june", "junio"],
    ["july", "julio"],
    ["august", "agosto"],
    ["september", "septiembre"],
    ["october", "octubre"],
    ["november", "noviembre"],
    ["december", "diciembre"],
    ["jan", "ene"],
    ["feb", "feb"],
    ["mar", "mar"],
    ["apr", "abr"],
    ["may", "may"],
    ["jun", "jun"],
    ["jul", "jul"],
    ["aug", "ago"],
    ["sep", "sep"],
    ["oct", "oct"],
    ["nov", "nov"],
    ["dec", "dic"],
  ]);
  return String(txt || "").replace(/\b([A-Za-z]{3,9})\b/g, (m) => {
    const repl = map.get(m.toLowerCase());
    return repl || m;
  });
};

module.exports = {
  nombre: "mi_resumen",

  async obtenerDatos(usuario) {
    const generado = await generarResumen(usuario.id, { sinSaludoInicial: true });
    const dolar = await obtenerDolarFresco(0);
    return { generado, dolar };
  },

  async renderizar(_usuario, datos) {
    const base = aplicarLayout("mi_resumen", _usuario, {
      mensaje: datos.generado.texto,
      fuenteDolar: datos.dolar.fuente || "n/a",
    });
    const mensaje = normalizarFechasEspanol(base);
    return {
      mensaje,
      meta: { resumenId: datos.generado.resumenId },
    };
  },
};
