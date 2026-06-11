"use strict";

const { registerTool } = require("./registry");

registerTool({
  name: "agent.clasificar",
  description:
    "Ejecuta el clasificador LLM (intención cerrada + verify de coherencia con historial) sobre el mensaje del turno y actualiza la clasificación en memoria. Usala si la intención actual parece placeholder o querés re-clasificar tras leer historial u otras tools.",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (ctx, _args) => {
    const { clasificarMensaje, normalizarClasificacion } = require("../../clasificador");
    const { fusionarIntencionPrecalculada } = require("../../consultas/intencion_precalculada");
    const mensaje = String(ctx.mensaje || "").trim();
    if (!mensaje) {
      throw new Error("sin_mensaje_en_ctx");
    }
    let c = await clasificarMensaje(mensaje, ctx.usuario, {
      historial: Array.isArray(ctx.historialReciente) ? ctx.historialReciente : [],
    });
    if (ctx.intencionPrecalculada && typeof ctx.intencionPrecalculada === "object") {
      c = normalizarClasificacion(fusionarIntencionPrecalculada(c, ctx.intencionPrecalculada, mensaje));
    }
    if (!ctx.clasificacion || typeof ctx.clasificacion !== "object") {
      throw new Error("sin_clasificacion_en_ctx");
    }
    Object.assign(ctx.clasificacion, c);
    return {
      intencion: c.intencion,
      confianza: c.confianza,
      cultivo: c.cultivo,
      producto: c.producto,
      meta_consulta: c.meta_consulta ?? null,
    };
  },
});
