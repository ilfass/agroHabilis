const { query } = require("../config/database");
const { generarConPromptLibre } = require("../services/gemini");
const { obtenerPrecioFresco, obtenerDolarFresco, variacion, formatearPrecio, separador } = require("./base");

module.exports = {
  nombre: "alerta",

  async obtenerDatos(usuario, alerta) {
    const precioActual = alerta.tipo.startsWith("dolar")
      ? null
      : await obtenerPrecioFresco(alerta.cultivo, 0);
    const dolar = await obtenerDolarFresco(0);
    const historial = await query(
      `
        SELECT fecha, AVG(precio)::numeric(12,2) AS precio
        FROM precios
        WHERE LOWER(cultivo) = LOWER($1)
          AND fecha >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY fecha
        ORDER BY fecha ASC
      `,
      [alerta.cultivo]
    );
    return { usuario, alerta, precioActual, dolar, historial30d: historial.rows || [] };
  },

  async renderizar(_usuario, datos) {
    const h = datos.historial30d;
    const ant = Number(h[h.length - 2]?.precio);
    const act = Number(h[h.length - 1]?.precio || datos.precioActual?.precio);
    const ctxVar = variacion(act, ant);
    let analisis = "Evaluá fijar parcial o cubrir posición según tu flujo de caja.";
    try {
      const ia = await generarConPromptLibre({
        system: "Sos asesor agro comercial. Breve y accionable.",
        user: `Alerta ${datos.alerta.cultivo} objetivo ${datos.alerta.valor_objetivo}. Precio actual ${act}. Variación ${ctxVar}.`,
      });
      analisis = String(ia.texto || analisis).trim();
    } catch (_e) {}
    const tc = (datos.dolar.items || []).find((x) => String(x.tipo).toLowerCase() === "oficial");
    return {
      mensaje: [
        "🚨 *ALERTA DE PRECIO*",
        separador(),
        `Cultivo: ${String(datos.alerta.cultivo || "").toUpperCase()}`,
        `Objetivo: ${formatearPrecio(datos.alerta.valor_objetivo)}`,
        `Precio actual: ${formatearPrecio(act)}`,
        `Variación vs ayer: ${ctxVar}`,
        `Dólar oficial: ${formatearPrecio(tc?.valor || null)}`,
        "",
        "💡 *Momento de decisión*",
        analisis,
        "",
        `Escribí *ANALIZAR ${String(datos.alerta.cultivo || "").toUpperCase()}* para análisis completo.`,
      ].join("\n"),
      meta: {},
    };
  },
};
