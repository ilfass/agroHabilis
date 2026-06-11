"use strict";

const { registerTool } = require("./registry");

registerTool({
  name: "agent.turn_step",
  description:
    "Registra un paso del plan del turno (observabilidad para admin vía ia_provider_trace; no se muestra al productor).",
  parameters: {
    type: "object",
    required: ["step"],
    properties: {
      step: { type: "string" },
      detail: { type: "object" },
    },
  },
  execute: async (ctx, args) => {
    const clasificacion = ctx.clasificacion;
    if (!clasificacion || typeof clasificacion !== "object") {
      return { skipped: true };
    }
    if (!Array.isArray(clasificacion.agentPlanTrace)) {
      clasificacion.agentPlanTrace = [];
    }
    const arr = clasificacion.agentPlanTrace;
    arr.push({
      t: Date.now(),
      step: String(args.step || "").slice(0, 120),
      detail:
        args.detail != null && typeof args.detail === "object" && !Array.isArray(args.detail)
          ? args.detail
          : null,
    });
    if (arr.length > 60) {
      clasificacion.agentPlanTrace = arr.slice(-60);
    }
    return { ok: true, len: clasificacion.agentPlanTrace.length };
  },
});
