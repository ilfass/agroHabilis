const { generarConPromptLibre } = require("../services/gemini");
const {
  obtenerPrecioFresco,
  obtenerDolarFresco,
  obtenerClimaFresco,
  obtenerNoticiasFrescas,
  formatearPrecio,
} = require("./base");

const normalizar = (t = "") =>
  String(t)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const detectarTemas = (pregunta = "") => {
  const t = normalizar(pregunta);
  const temas = [];
  if (/(precio|cotizacion|cotizacion|mercado|soja|maiz|trigo|girasol|papa)/.test(t)) temas.push("precio");
  if (/dolar|mep|blue|oficial|ccl/.test(t)) temas.push("dolar");
  if (/clima|lluvia|helada|viento|pronostico/.test(t)) temas.push("clima");
  if (/vender|venta|margen|rentabilidad|conviene/.test(t)) temas.push("venta");
  return [...new Set(temas)];
};

const detectarCultivo = (pregunta = "") => {
  const t = normalizar(pregunta);
  if (t.includes("soja")) return "soja";
  if (t.includes("maiz")) return "maiz";
  if (t.includes("trigo")) return "trigo";
  if (t.includes("girasol")) return "girasol";
  if (t.includes("papa")) return "papa";
  return null;
};

module.exports = {
  nombre: "consulta",
  detectarTemas,

  async obtenerDatos(usuario, pregunta) {
    const temas = detectarTemas(pregunta);
    const cultivo = detectarCultivo(pregunta) || usuario?.cultivos?.[0]?.cultivo || null;
    const datos = { temas, cultivo };
    if (temas.includes("precio") && cultivo) datos.precio = await obtenerPrecioFresco(cultivo, 2);
    if (temas.includes("dolar")) datos.dolar = await obtenerDolarFresco(0);
    if (temas.includes("clima") && usuario?.lat != null && usuario?.lng != null) {
      datos.clima = await obtenerClimaFresco(usuario.lat, usuario.lng, 3);
    }
    datos.noticias = await obtenerNoticiasFrescas([cultivo, ...temas].filter(Boolean), 3);
    return datos;
  },

  async renderizar(usuario, datos, pregunta) {
    const payload = {
      usuario: { nombre: usuario?.nombre, zona: `${usuario?.partido || ""}, ${usuario?.provincia || ""}` },
      pregunta,
      datos,
    };
    try {
      const ia = await generarConPromptLibre({
        system: "Respondé como asesor agro argentino. Claro, concreto, sin inventar datos.",
        user: JSON.stringify(payload, null, 2),
      });
      return { mensaje: String(ia.texto || "").trim(), meta: { temas: datos.temas } };
    } catch (_e) {
      const precio = datos.precio ? `Precio ${datos.cultivo}: ${formatearPrecio(datos.precio.precio)}` : null;
      return {
        mensaje: [precio, "No pude usar IA en este momento; te respondo con datos directos."].filter(Boolean).join("\n"),
        meta: { temas: datos.temas },
      };
    }
  },
};
