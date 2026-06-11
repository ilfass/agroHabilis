"use strict";

const { registerTool } = require("./registry");

registerTool({
  name: "agent.consulta_datos_compactos",
  description:
    "Hechos internos ya armados por el motor AgroHabilis: texto respuesta_base (reglas + datos BD) y recorte JSON de la consulta (precios, clima, dólar, hilo). Usalo como fuente de verdad antes de opinar o inventar cifras.",
  parameters: {
    type: "object",
    properties: {
      seccion: {
        type: "string",
        description: "Opcional: resumen | clima | precio | todo (default todo)",
      },
    },
  },
  execute: async (ctx, args) => {
    const raw = ctx.consultaAgentePayload;
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "sin_consultaAgentePayload_en_ctx" };
    }
    const sec = String(args?.seccion || "todo").toLowerCase();
    if (sec === "resumen" || sec === "base") {
      return { ok: true, respuesta_base: String(raw.respuesta_base || "").slice(0, 14000) };
    }
    if (sec === "clima") {
      return { ok: true, clima_pronostico_resumen: String(raw.clima_pronostico_resumen || "").slice(0, 4000) };
    }
    if (sec === "precio" || sec === "datos") {
      return { ok: true, datos_json: String(raw.datos_json || "").slice(0, 16000) };
    }
    return {
      ok: true,
      respuesta_base: String(raw.respuesta_base || "").slice(0, 12000),
      clima_pronostico_resumen: String(raw.clima_pronostico_resumen || "").slice(0, 2500),
      datos_json: String(raw.datos_json || "").slice(0, 12000),
      contexto_hilo: String(raw.contexto_hilo || "").slice(0, 4000),
    };
  },
});
