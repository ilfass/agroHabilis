"use strict";

const { registerTool } = require("./registry");

/**
 * Cierra el turno vía `routear` (precios, clima, plantillas, comandos, etc.).
 * El modelo puede ajustar la clasificación o inyectar contexto tipo scout antes.
 */
registerTool({
  name: "agent.invoke_router",
  description:
    "Obtiene el texto final para el productor usando el motor interno (precios, clima, rutas por intención). Llamala cuando ya tengas suficiente contexto de otras tools; podés pasar scout_context con hallazgos breves y clasificacion_patch solo si hace falta corregir intención o cultivo.",
  parameters: {
    type: "object",
    properties: {
      clasificacion_patch: {
        type: "object",
        description:
          "Campos opcionales a fusionar con la clasificación actual (intencion, cultivo, confianza, producto, variante_precio, requiere_datos_propios, etc.).",
      },
      scout_context: {
        type: "string",
        description: "Resumen corto de hallazgos previos (historial, docs) para el router.",
      },
    },
  },
  execute: async (ctx, args) => {
    const { clasificacion, usuario, numeroWhatsapp } = ctx;
    if (!clasificacion || typeof clasificacion !== "object") {
      return { ok: false, error: "sin_clasificacion_en_ctx" };
    }
    const mensaje = String(ctx.mensaje || "").trim();
    const patch =
      args.clasificacion_patch && typeof args.clasificacion_patch === "object" ? args.clasificacion_patch : {};
    const scout = String(args.scout_context || "").trim();
    const { normalizarClasificacion } = require("../../clasificador");
    const { routear } = require("../../router");
    const merged = normalizarClasificacion({ ...clasificacion, ...patch });
    Object.assign(clasificacion, merged);
    if (scout) {
      clasificacion.agentScoutContext = scout.slice(0, 8000);
    }
    const texto = await routear({
      clasificacion,
      mensaje,
      usuario,
      numeroWhatsapp,
    });
    return {
      texto: String(texto || "").trim(),
      intencion: clasificacion.intencion,
    };
  },
});
